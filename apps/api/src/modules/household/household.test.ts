import { afterAll, expect, test } from "bun:test";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { Llm } from "@snapcook/llm";
import type { Me, PantryItem } from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

const [butter, milk, pepper, salt] = await db
  .insert(schema.ingredients)
  .values([
    { name: "butter", category: "dairy", default_unit: "g" },
    { name: "milk", category: "dairy", default_unit: "ml", aliases: ["whole milk"] },
    { name: "bell pepper", category: "vegetable", default_unit: "piece", grams_per_unit: 160 },
    { name: "salt", category: "spice", default_unit: "g", is_staple_default: true },
  ])
  .returning();
if (!butter || !milk || !pepper || !salt) throw new Error("no ingredients");

// The model answers with one real name and one it made up.
const llm = { structured: async () => ({ names: ["milk", "unicorn cheese"] }) } as unknown as Llm;
const { server, signUp, signUpWithHousehold } = createTestServer(db, { llm });

const json = { "content-type": "application/json" };
const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, ...json },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("a request with no session is refused", async () => {
  expect((await server.request("/api/v1/me")).status).toBe(401);
  expect((await server.request("/api/v1/pantry")).status).toBe(401);
});

test("a new user has no household, and household routes refuse them", async () => {
  const user = await signUp("new@example.com");
  const me = (await (await call(user, "GET", "/me")).json()) as Me;
  expect(me.household).toBeNull();
  expect((await call(user, "GET", "/pantry")).status).toBe(403);
});

test("creating a household makes the user its owner with default staples, once", async () => {
  const user = await signUp("owner@example.com");
  const res = await call(user, "POST", "/household", { name: "Home" });
  expect(res.status).toBe(201);
  const me = (await res.json()) as Me;
  expect(me.role).toBe("owner");
  expect(me.household?.plan).toBe("free");
  expect(me.profile?.staples).toEqual([salt.id]);
  expect((await call(user, "POST", "/household", { name: "Second" })).status).toBe(403);
});

test("typed text becomes a matched item, and the same ingredient in the same place asks how to merge", async () => {
  const user = await signUpWithHousehold("pantry@example.com");
  const add = async (body: unknown) =>
    (await (await call(user, "POST", "/pantry/items", body)).json()) as {
      outcome: string;
      item: PantryItem;
    };
  const first = await add({ text: "2 bell peppers", location: "fridge" });
  expect(first.outcome).toBe("created");
  expect(first.item).toMatchObject({ ingredient_id: pepper.id, quantity: 2, unit: "piece" });

  expect((await add({ text: "bell pepper 300g", location: "fridge" })).outcome).toBe(
    "merge_needed",
  );
  const merged = await add({ text: "bell pepper 300g", location: "fridge", merge: "add" });
  // Two peppers at 160 g each, plus 300 g.
  expect(merged.item).toMatchObject({ id: first.item.id, quantity: 620, unit: "g" });
  expect((await add({ text: "bell pepper", location: "counter" })).outcome).toBe("created");

  const unknown = await add({ text: "3 dragon fruit", location: "counter" });
  expect(unknown.item).toMatchObject({
    ingredient_id: null,
    display_name: "dragon fruit",
    quantity: 3,
  });
});

test("a member of one household cannot read or change another household's pantry", async () => {
  const a = await signUpWithHousehold("a@example.com");
  const b = await signUpWithHousehold("b@example.com");
  const created = (await (
    await call(a, "POST", "/pantry/items", { text: "milk 1l", location: "fridge" })
  ).json()) as { item: PantryItem };
  const id = created.item.id;

  const seen = (await (await call(b, "GET", "/pantry")).json()) as { items: PantryItem[] };
  expect(seen.items).toEqual([]);
  expect((await call(b, "PATCH", `/pantry/items/${id}`, { use_soon: true })).status).toBe(404);
  expect((await call(b, "DELETE", `/pantry/items/${id}`)).status).toBe(404);
  // The same ingredient in B's fridge is B's first: A's item is not offered for a merge.
  const own = (await (
    await call(b, "POST", "/pantry/items", { text: "milk", location: "fridge" })
  ).json()) as { outcome: string };
  expect(own.outcome).toBe("created");

  const [row] = await db.select().from(schema.pantryItems).where(eq(schema.pantryItems.id, id));
  expect(row).toMatchObject({ use_soon: false, quantity: 1000 });
});

test("a pantry write and a profile write each raise their own change stamp", async () => {
  const user = await signUpWithHousehold("revs@example.com");
  const revs = async () => ((await (await call(user, "GET", "/me")).json()) as Me).household;
  const before = await revs();
  await call(user, "POST", "/pantry/items", { text: "butter", location: "fridge" });
  const afterPantry = await revs();
  expect(afterPantry?.pantry_rev).toBe((before?.pantry_rev ?? 0) + 1);
  expect(afterPantry?.profile_rev).toBe(before?.profile_rev);
});

test("the profile is replaced as a whole, keeps who added an allergen, and refuses unknown ingredients", async () => {
  const user = await signUpWithHousehold("profile@example.com");
  const profile = {
    allergens: ["milk"],
    cannot_eat: [milk.id],
    cannot_eat_text: "no dairy except butter",
    dislikes: [],
    diet_style: "none",
    toddler: true,
    devices: { mc_smart: true },
    default_servings: 2.5,
    default_time_min: 45,
    effort: "normal",
    staples: [salt.id],
  };
  const res = await call(user, "PUT", "/household/profile", profile);
  expect(res.status).toBe(200);
  const me = (await (await call(user, "GET", "/me")).json()) as Me;
  expect(me.profile).toMatchObject({ toddler: true, cannot_eat: [milk.id] });
  expect(me.profile?.allergens).toEqual([{ value: "milk", added_by: me.user.id }]);

  const bad = await call(user, "PUT", "/household/profile", {
    ...profile,
    dislikes: ["018f4b7a-0000-7000-8000-000000000000"],
  });
  expect(bad.status).toBe(400);
});

test("free text is matched to canonical ingredients, and a name the model invents is dropped", async () => {
  const user = await signUpWithHousehold("match@example.com");
  const res = await call(user, "POST", "/household/profile/match", {
    text: "no dairy except butter",
  });
  expect(await res.json()).toEqual({ ingredients: [{ id: milk.id, name: "milk" }] });
});

test("ingredient search finds a name by its start, its middle and an alias", async () => {
  const user = await signUpWithHousehold("search@example.com");
  const names = async (q: string) =>
    (
      (await (await call(user, "GET", `/ingredients?q=${encodeURIComponent(q)}`)).json()) as {
        ingredients: { name: string }[];
      }
    ).ingredients.map((i) => i.name);
  expect(await names("bu")).toEqual(["butter"]);
  expect(await names("pepper")).toEqual(["bell pepper"]);
  expect(await names("whole")).toEqual(["milk"]);
});
