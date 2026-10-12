import { afterAll, expect, test } from "bun:test";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { PantryItem, ShoppingItem } from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

const [pepper, milk] = await db
  .insert(schema.ingredients)
  .values([
    { name: "bell pepper", category: "vegetable", default_unit: "piece", grams_per_unit: 160 },
    { name: "milk", category: "dairy", default_unit: "ml" },
  ])
  .returning();
if (!pepper || !milk) throw new Error("no ingredients");
const [recipe] = await db
  .insert(schema.recipes)
  .values({ slug: "peppers", status: "auto_reviewed" })
  .returning();
if (!recipe) throw new Error("no recipe");
const [version] = await db
  .insert(schema.recipeVersions)
  .values({
    recipe_id: recipe.id,
    version: 1,
    title: "Stuffed peppers",
    cuisine: "turkish",
    dish_type: "main",
    primary_protein: "vegetable",
    technique: "bake",
    time_total_min: 50,
    time_active_min: 15,
    difficulty: 1,
    base_servings: 4,
    description: "",
    steps: [{ index: 0, lane: "main", kind: "oven", text: "Bake.", minutes: 40 }],
    provenance: { references: [], writer_model: "w", reviewer: "r", notes: null },
  })
  .returning();
await db
  .update(schema.recipes)
  .set({ current_version_id: version?.id })
  .where(eq(schema.recipes.id, recipe.id));

const { server, signUpWithHousehold } = createTestServer(db);
const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type List = { items: ShoppingItem[]; recipes: Record<string, string> };
const list = async (headers: Record<string, string>) =>
  (await (await call(headers, "GET", "/list")).json()) as List;
const add = (headers: Record<string, string>, ...items: unknown[]) =>
  call(headers, "POST", "/list/items", { items });
const fromRecipe = {
  ingredient_id: pepper.id,
  display_name: "bell pepper",
  quantity: 2,
  unit: "piece",
  recipe_id: recipe.id,
};

test("lines land in their aisle, merge by ingredient and remember which recipe wants them", async () => {
  const user = await signUpWithHousehold("list@example.com");
  await add(user, fromRecipe, { text: "milk 1l" }, { text: "birthday candles" });
  // A second need for peppers, by weight this time: one line, in grams.
  await add(user, { text: "bell peppers 300g" });
  const { items, recipes } = await list(user);
  expect(items.map((i) => [i.aisle, i.display_name, i.quantity, i.unit])).toEqual([
    ["produce", "bell pepper", 620, "g"],
    ["dairy", "milk", 1000, "ml"],
    ["other", "birthday candles", null, null],
  ]);
  expect(items[0]?.wanted_by).toEqual([recipe.id]);
  expect(recipes).toEqual({ [recipe.id]: "Stuffed peppers" });
});

test("put-away moves only the ticked lines into the pantry and adds to what is there", async () => {
  const user = await signUpWithHousehold("putaway@example.com");
  await call(user, "POST", "/pantry/items", { text: "1 bell pepper", location: "fridge" });
  await add(user, fromRecipe, { text: "milk 1l" });
  const before = await list(user);
  const peppers = before.items.find((i) => i.ingredient_id === pepper.id);
  expect((await call(user, "PATCH", `/list/items/${peppers?.id}`, { bought: true })).status).toBe(
    200,
  );

  expect(await (await call(user, "POST", "/list/put-away", { location: "fridge" })).json()).toEqual(
    { moved: 1 },
  );
  expect((await list(user)).items.map((i) => i.display_name)).toEqual(["milk"]);
  const pantry = ((await (await call(user, "GET", "/pantry")).json()) as { items: PantryItem[] })
    .items;
  expect(pantry.map((i) => [i.display_name, i.quantity])).toEqual([["bell pepper", 3]]);

  // A line bought again after that starts a new line, not the one that was put away.
  await add(user, fromRecipe);
  expect((await list(user)).items).toHaveLength(2);
});

test("one household cannot read, tick, remove or put away another's list", async () => {
  const a = await signUpWithHousehold("list-a@example.com");
  const b = await signUpWithHousehold("list-b@example.com");
  await add(a, { text: "milk" });
  const [line] = (await list(a)).items;
  expect((await list(b)).items).toEqual([]);
  expect((await call(b, "PATCH", `/list/items/${line?.id}`, { bought: true })).status).toBe(404);
  expect((await call(b, "DELETE", `/list/items/${line?.id}`)).status).toBe(404);
  await call(a, "PATCH", `/list/items/${line?.id}`, { bought: true });
  expect(await (await call(b, "POST", "/list/put-away", { location: "fridge" })).json()).toEqual({
    moved: 0,
  });
  expect((await list(a)).items).toHaveLength(1);
});

test("a recipe is saved once, listed, and removed, per household", async () => {
  const a = await signUpWithHousehold("saved-a@example.com");
  const b = await signUpWithHousehold("saved-b@example.com");
  expect((await call(a, "PUT", `/saved/${recipe.id}`)).status).toBe(204);
  expect((await call(a, "PUT", `/saved/${recipe.id}`)).status).toBe(204);
  const saved = async (headers: Record<string, string>) =>
    (
      (await (await call(headers, "GET", "/saved")).json()) as { saved: { title: string }[] }
    ).saved.map((s) => s.title);
  expect(await saved(a)).toEqual(["Stuffed peppers"]);
  expect(await saved(b)).toEqual([]);
  expect((await call(a, "PUT", "/saved/018f4b7a-0000-7000-8000-000000000000")).status).toBe(404);
  await call(a, "DELETE", `/saved/${recipe.id}`);
  expect(await saved(a)).toEqual([]);
});
