import { afterAll, expect, test } from "bun:test";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { Llm } from "@snapcook/llm";
import type {
  AdaptedRecipe,
  CookView,
  FinishCookResponse,
  PantryItem,
  RescueResponse,
} from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

const [rice, pepper] = await db
  .insert(schema.ingredients)
  .values([
    { name: "rice", category: "rice", default_unit: "g" },
    { name: "bell pepper", category: "vegetable", default_unit: "piece", grams_per_unit: 160 },
  ])
  .returning();
if (!rice || !pepper) throw new Error("no ingredients");
const [riceId, pepperId] = [rice.id, pepper.id];
const [recipe] = await db
  .insert(schema.recipes)
  .values({ slug: "pilaf", status: "auto_reviewed" })
  .returning();
if (!recipe) throw new Error("no recipe");
const steps = [
  { index: 0, lane: "main" as const, kind: "pan" as const, text: "Cook the rice.", minutes: 20 },
];
const [version] = await db
  .insert(schema.recipeVersions)
  .values({
    recipe_id: recipe.id,
    version: 1,
    title: "Pilaf",
    cuisine: "turkish",
    dish_type: "rice",
    primary_protein: "vegetable",
    technique: "simmer",
    time_total_min: 30,
    time_active_min: 10,
    difficulty: 1,
    base_servings: 4,
    description: "",
    steps,
    failure_modes: [{ symptom: "The rice is mushy.", fix: "Spread it on a tray to steam dry." }],
    provenance: { references: [], writer_model: "w", reviewer: "r", notes: null },
  })
  .returning();
if (!version) throw new Error("no version");

// The question "mushy" sits next to the known failure; anything else is far from it.
const vector = (near: boolean) =>
  Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : near ? 0 : i === 1 ? 5 : 0));
const llm = {
  embed: async (texts: string[]) => texts.map((text) => vector(text.includes("mushy"))),
  structured: async () => ({ answer: "Turn the heat down and add a splash of water." }),
} as unknown as Llm;
const { server, signUpWithHousehold } = createTestServer(db, { llm });
const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const add = async (headers: Record<string, string>, text: string) =>
  (
    (await (await call(headers, "POST", "/pantry/items", { text, location: "pantry" })).json()) as {
      item: PantryItem;
    }
  ).item;
const pantry = async (headers: Record<string, string>) =>
  ((await (await call(headers, "GET", "/pantry")).json()) as { items: PantryItem[] }).items;

/** A household with rice and peppers, and a stored adaptation that uses both. */
async function kitchen(email: string) {
  const user = await signUpWithHousehold(email);
  const me = (await (await call(user, "GET", "/me")).json()) as { household: { id: string } };
  const riceItem = await add(user, "rice 500g");
  const peppers = await add(user, "3 bell peppers");
  const output: AdaptedRecipe = {
    servings: 2,
    ingredients: [
      {
        ingredient_id: riceId,
        display: "rice",
        quantity: 200,
        unit: "g",
        status: "in_pantry",
        pantry_item_id: riceItem.id,
      },
      {
        ingredient_id: pepperId,
        display: "bell pepper",
        quantity: 1,
        unit: "piece",
        status: "in_pantry",
        pantry_item_id: peppers.id,
      },
    ],
    steps,
    deductions: [
      { pantry_item_id: riceItem.id, quantity: 200, unit: "g" },
      { pantry_item_id: peppers.id, quantity: 1, unit: "piece" },
    ],
    tips: [],
    toddler_notes: [],
  };
  const [adaptation] = await db
    .insert(schema.adaptations)
    .values({
      household_id: me.household.id,
      recipe_version_id: version?.id ?? "",
      input_hash: "a".repeat(64),
      controls: {
        servings: 2,
        device_profile_id: null,
        swaps: [],
        toddler_safe: false,
        lazier: false,
      },
      output,
      model: "m",
      cost_usd: 0,
    })
    .returning();
  const cook = (await (
    await call(user, "POST", "/cooks", { adaptation_id: adaptation?.id })
  ).json()) as CookView;
  return { user, riceItem, peppers, output, cook, adaptationId: adaptation?.id ?? "" };
}

test("finishing a cook takes what it used from the pantry, once", async () => {
  const { user, riceItem, peppers, output, cook } = await kitchen("cook@example.com");
  expect(cook).toMatchObject({ title: "Pilaf", current_step: 0, finished_at: null });
  expect((await call(user, "PATCH", `/cooks/${cook.id}`, { current_step: 1 })).status).toBe(204);

  // The household used the whole bag of rice, not the 200 g the recipe asked for.
  const deductions = [{ ...output.deductions[0], quantity: 500 }, output.deductions[1]];
  const done = (await (
    await call(user, "POST", `/cooks/${cook.id}/finish`, {
      deductions,
      rating: 2,
      notes: "Too dry.",
    })
  ).json()) as FinishCookResponse;
  expect(done).toMatchObject({ outcome: "finished", used_up: [{ display_name: "rice" }] });
  expect((await pantry(user)).map((i) => [i.id, i.quantity, i.source])).toEqual([
    [peppers.id, 2, "draw_down"],
  ]);

  const again = (await (
    await call(user, "POST", `/cooks/${cook.id}/finish`, { deductions })
  ).json()) as FinishCookResponse;
  expect(again.outcome).toBe("finished");
  expect((await pantry(user))[0]?.quantity).toBe(2);
  expect(riceItem.id).not.toBe(peppers.id);

  const reports = await db
    .select()
    .from(schema.recipeReports)
    .where(eq(schema.recipeReports.kind, "rating"));
  expect(reports.map((r) => r.payload)).toEqual([
    { cook_session_id: cook.id, rating: 2, notes: "Too dry." },
  ]);
  const history = (await (await call(user, "GET", "/cooks")).json()) as {
    cooks: { id: string; rating: number }[];
  };
  expect(history.cooks).toMatchObject([{ id: cook.id, rating: 2 }]);
});

test("skipping the update ends the cook and leaves the pantry as it was", async () => {
  const { user, cook } = await kitchen("skip@example.com");
  const done = (await (
    await call(user, "POST", `/cooks/${cook.id}/finish`, { deductions: [] })
  ).json()) as FinishCookResponse;
  expect(done).toEqual({ outcome: "finished", applied: [], used_up: [] });
  expect((await pantry(user)).map((i) => i.quantity).sort()).toEqual([3, 500]);
});

test("a deduction that cannot be converted changes nothing and is handed back", async () => {
  const { user, riceItem, peppers, cook } = await kitchen("convert@example.com");
  // Rice has no weight per piece, so "2 pieces" of it means nothing.
  const deductions = [
    { pantry_item_id: peppers.id, quantity: 160, unit: "g" },
    { pantry_item_id: riceItem.id, quantity: 2, unit: "piece" },
  ];
  const res = (await (
    await call(user, "POST", `/cooks/${cook.id}/finish`, { deductions })
  ).json()) as FinishCookResponse;
  expect(res).toEqual({
    outcome: "needs_input",
    needs_input: [deductions[1]],
  } as FinishCookResponse);
  expect((await pantry(user)).map((i) => i.quantity).sort()).toEqual([3, 500]);
  expect(
    ((await (await call(user, "GET", `/cooks/${cook.id}`)).json()) as CookView).finished_at,
  ).toBeNull();
});

test("an item kept as some is removed only when the household says it is gone", async () => {
  const { user, cook } = await kitchen("gone@example.com");
  const some = await add(user, "saffron");
  const done = (await (
    await call(user, "POST", `/cooks/${cook.id}/finish`, { deductions: [], gone: [some.id] })
  ).json()) as FinishCookResponse;
  expect(done).toMatchObject({ used_up: [{ display_name: "saffron" }] });
  expect(await pantry(user)).toHaveLength(2);
});

test("another household cannot see, start, finish or draw down a cook that is not its own", async () => {
  const a = await kitchen("cook-a@example.com");
  const b = await signUpWithHousehold("cook-b@example.com");
  expect((await call(b, "GET", `/cooks/${a.cook.id}`)).status).toBe(404);
  expect((await call(b, "POST", "/cooks", { adaptation_id: a.adaptationId })).status).toBe(404);
  expect(
    (await call(b, "POST", `/cooks/${a.cook.id}/finish`, { deductions: a.output.deductions }))
      .status,
  ).toBe(404);
  expect(
    (await call(b, "POST", `/cooks/${a.cook.id}/rescue`, { step_index: 0, text: "mushy rice" }))
      .status,
  ).toBe(404);

  // B's own cook cannot reach into A's pantry by naming A's item.
  const own = await kitchen("cook-c@example.com");
  await call(own.user, "POST", `/cooks/${own.cook.id}/finish`, {
    deductions: [{ pantry_item_id: a.riceItem.id, quantity: 500, unit: "g" }],
  });
  expect((await pantry(a.user)).map((i) => i.quantity).sort()).toEqual([3, 500]);
});

test("a known failure gets the stored fix; anything else goes to the model; both are kept", async () => {
  const { user, cook } = await kitchen("rescue@example.com");
  const known = (await (
    await call(user, "POST", `/cooks/${cook.id}/rescue`, {
      step_index: 0,
      text: "it has gone mushy",
    })
  ).json()) as RescueResponse;
  expect(known).toEqual({ answer: "Spread it on a tray to steam dry.", source: "known_fix" });
  const other = (await (
    await call(user, "POST", `/cooks/${cook.id}/rescue`, {
      step_index: 0,
      text: "the pan is catching",
    })
  ).json()) as RescueResponse;
  expect(other.source).toBe("model");
  const kept = await db
    .select()
    .from(schema.recipeReports)
    .where(eq(schema.recipeReports.kind, "rescue"));
  expect(kept).toHaveLength(2);
});
