import { afterAll, expect, test } from "bun:test";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { Llm } from "@snapcook/llm";
import type { AdaptResponse, RecipeView } from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";
import type { AdaptedDraft } from "./adapt";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

const [chicken, cream, coconut, salt] = await db
  .insert(schema.ingredients)
  .values([
    { name: "chicken thigh", category: "poultry", default_unit: "g", contains: ["meat"] },
    {
      name: "double cream",
      category: "dairy",
      default_unit: "ml",
      allergens: ["milk"],
      contains: ["dairy"],
    },
    { name: "coconut milk", category: "other", default_unit: "ml" },
    { name: "salt", category: "spice", default_unit: "g", is_staple_default: true },
  ])
  .returning();
if (!chicken || !cream || !coconut || !salt) throw new Error("no ingredients");
await db
  .insert(schema.ingredientSubstitutes)
  .values({ ingredient_id: cream.id, substitute_id: coconut.id, context: "general" });

const [recipe] = await db
  .insert(schema.recipes)
  .values({ slug: "creamy-chicken", status: "auto_reviewed" })
  .returning();
if (!recipe) throw new Error("no recipe");
const steps = [
  { index: 0, lane: "main" as const, kind: "pan" as const, text: "Brown.", minutes: 10 },
  { index: 1, lane: "main" as const, kind: "pan" as const, text: "Simmer.", minutes: 20 },
];
const [version] = await db
  .insert(schema.recipeVersions)
  .values({
    recipe_id: recipe.id,
    version: 1,
    title: "Creamy chicken",
    cuisine: "french",
    dish_type: "main",
    primary_protein: "chicken_thigh",
    technique: "braise",
    time_total_min: 30,
    time_active_min: 10,
    difficulty: 1,
    base_servings: 4,
    description: "Chicken in cream.",
    steps,
    provenance: { references: [], writer_model: "w", reviewer: "r", notes: null },
  })
  .returning();
if (!version) throw new Error("no version");
await db
  .update(schema.recipes)
  .set({ current_version_id: version.id })
  .where(eq(schema.recipes.id, recipe.id));
await db.insert(schema.recipeIngredients).values([
  {
    recipe_version_id: version.id,
    ingredient_id: chicken.id,
    quantity: 800,
    unit: "g",
    role: "core",
    position: 0,
  },
  {
    recipe_version_id: version.id,
    ingredient_id: cream.id,
    quantity: 200,
    unit: "ml",
    role: "core",
    position: 1,
  },
  { recipe_version_id: version.id, ingredient_id: salt.id, role: "staple", position: 2 },
]);

const line = (
  ingredient_id: string,
  quantity: number | null,
  unit: "g" | "ml" | null,
  substituted_for: string | null = null,
) => ({
  ingredient_id,
  quantity,
  unit,
  substituted_for,
});
const draft = (ingredients: AdaptedDraft["ingredients"]): AdaptedDraft => ({
  ingredients,
  steps,
  tips: ["Rest it."],
  toddler_notes: [],
  refused: null,
});
const withCream = draft([
  line(chicken.id, 400, "g"),
  line(cream.id, 100, "ml"),
  line(salt.id, null, null),
]);
const withCoconut = draft([
  line(chicken.id, 400, "g"),
  line(coconut.id, 100, "ml", cream.id),
  line(salt.id, null, null),
]);
const noChicken = draft([line(cream.id, 100, "ml"), line(salt.id, null, null)]);

// The model's answers, in the order it gives them. A test sets what comes next.
let answers: AdaptedDraft[] = [];
let calls = 0;
const llm = {
  structured: async (
    _prompt: unknown,
    _schema: unknown,
    ctx: { onCost?: (usd: number) => void },
  ) => {
    calls += 1;
    ctx.onCost?.(0.01);
    const next = answers.shift();
    if (!next) throw new Error("the model was not expected to be called");
    return next;
  },
} as unknown as Llm;
const { server, signUpWithHousehold } = createTestServer(db, { llm });
const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const adaptFor = (headers: Record<string, string>, controls: object = {}) =>
  call(headers, "POST", "/adaptations", { recipe_version_id: version.id, controls });

test("a recipe reads as written, with ingredient names", async () => {
  const user = await signUpWithHousehold("read@example.com");
  const view = (await (await call(user, "GET", `/recipes/${recipe.id}`)).json()) as RecipeView;
  expect(view).toMatchObject({
    title: "Creamy chicken",
    recipe_version_id: version.id,
    has_device_variant: false,
  });
  expect(view.ingredients.map((i) => i.name)).toEqual(["chicken thigh", "double cream", "salt"]);
});

test("the first open runs the model once, a faulty answer is retried, and the second open is the stored answer", async () => {
  const user = await signUpWithHousehold("adapt@example.com");
  await call(user, "POST", "/pantry/items", { text: "chicken thigh 500g", location: "fridge" });
  answers = [noChicken, withCream];
  calls = 0;
  const first = (await (await adaptFor(user)).json()) as AdaptResponse;
  expect(calls).toBe(2);
  expect(first.controls).toMatchObject({
    servings: 2.5,
    device_profile_id: null,
    toddler_safe: false,
  });
  expect(first.recipe.ingredients.map((i) => [i.display, i.status])).toEqual([
    ["chicken thigh", "in_pantry"],
    ["double cream", "missing"],
    ["salt", "staple"],
  ]);
  expect(first.recipe.deductions.map((d) => [d.quantity, d.unit])).toEqual([[400, "g"]]);
  expect(first.swap_options[cream.id]).toEqual([]);

  const again = (await (await adaptFor(user)).json()) as AdaptResponse;
  expect(calls).toBe(2);
  expect(again.adaptation_id).toBe(first.adaptation_id);

  const [row] = await db
    .select()
    .from(schema.adaptations)
    .where(eq(schema.adaptations.id, first.adaptation_id));
  expect(row).toMatchObject({ model: "test-model", cost_usd: 0.02 });
});

test("an answer that breaks the rules twice is refused and nothing is stored", async () => {
  const user = await signUpWithHousehold("refused@example.com");
  answers = [noChicken, noChicken];
  const res = await adaptFor(user);
  expect(res.status).toBe(422);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("adaptation_refused");
});

test("an allergen with a stand-in on hand is replaced; with none, the household is told and no model is asked", async () => {
  const user = await signUpWithHousehold("allergy@example.com");
  const profile = (
    (await (await call(user, "GET", "/household/profile")).json()) as {
      profile: Record<string, unknown>;
    }
  ).profile;
  const { household_id: _id, allergens: _a, ...rest } = profile;
  await call(user, "PUT", "/household/profile", { ...rest, allergens: ["milk"] });
  await call(user, "POST", "/pantry/items", { text: "chicken thigh 500g", location: "fridge" });

  answers = [];
  calls = 0;
  const blocked = (await (await adaptFor(user)).json()) as AdaptResponse;
  expect(calls).toBe(0);
  expect(blocked.recipe.refused?.reason).toContain("double cream");

  await call(user, "POST", "/pantry/items", { text: "coconut milk 400ml", location: "pantry" });
  // The model puts the allergen back first; that answer must not get through.
  answers = [withCream, withCoconut];
  const safe = (await (await adaptFor(user)).json()) as AdaptResponse;
  expect(safe.recipe.ingredients.map((i) => [i.display, i.status])).toEqual([
    ["chicken thigh", "in_pantry"],
    ["coconut milk", "substituted"],
    ["salt", "staple"],
  ]);
});

test("a swap that names another household's pantry item is ignored", async () => {
  const a = await signUpWithHousehold("swap-a@example.com");
  const b = await signUpWithHousehold("swap-b@example.com");
  const theirs = (await (
    await call(a, "POST", "/pantry/items", { text: "coconut milk", location: "pantry" })
  ).json()) as { item: { id: string } };
  answers = [withCream];
  const out = (await (
    await adaptFor(b, { swaps: [{ ingredient_id: cream.id, pantry_item_id: theirs.item.id }] })
  ).json()) as AdaptResponse;
  expect(out.controls.swaps).toEqual([]);
});
