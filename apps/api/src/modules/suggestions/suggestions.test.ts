import { afterAll, expect, test } from "bun:test";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { SuggestResponse } from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

const named = await db
  .insert(schema.ingredients)
  .values(
    ["chicken thigh", "rice", "leek", "cream", "lentils", "onion", "salt"].map((name) => ({
      name,
      category: "other" as const,
      default_unit: "g" as const,
      is_staple_default: name === "salt",
    })),
  )
  .returning();
const id = (name: string) => named.find((i) => i.name === name)?.id ?? "";

// Eight dishes that all need only chicken, each a different cuisine, so paging has something to do.
// One lentil dish that needs lentils and onion.
async function dish(
  slug: string,
  cuisine: string,
  protein: string,
  lines: [string, "core" | "supporting" | "staple"][],
) {
  const [recipe] = await db
    .insert(schema.recipes)
    .values({ slug, status: "auto_reviewed" })
    .returning();
  if (!recipe) throw new Error("no recipe");
  const [version] = await db
    .insert(schema.recipeVersions)
    .values({
      recipe_id: recipe.id,
      version: 1,
      title: slug,
      cuisine,
      dish_type: "main",
      primary_protein: protein,
      technique: `technique-${slug}`,
      time_total_min: 30,
      time_active_min: 10,
      difficulty: 1,
      base_servings: 4,
      description: "",
      steps: [{ index: 0, lane: "main", kind: "pan", text: "Cook.", minutes: 30 }],
      provenance: { references: [], writer_model: "w", reviewer: "r", notes: null },
    })
    .returning();
  if (!version) throw new Error("no version");
  await db
    .update(schema.recipes)
    .set({ current_version_id: version.id })
    .where(eq(schema.recipes.id, recipe.id));
  await db.insert(schema.recipeIngredients).values(
    lines.map(([name, role], position) => ({
      recipe_version_id: version.id,
      ingredient_id: id(name),
      role,
      position,
    })),
  );
}
for (let i = 0; i < 8; i += 1) {
  await dish(`chicken-${i}`, `cuisine-${i}`, "chicken_thigh", [
    ["chicken thigh", "core"],
    ["leek", "supporting"],
    ["salt", "staple"],
  ]);
}
await dish("dal", "indian", "pulse", [
  ["lentils", "core"],
  ["onion", "core"],
]);

const { server, signUpWithHousehold } = createTestServer(db);
const post = (headers: Record<string, string>, path: string, body: unknown) =>
  server.request(`/api/v1${path}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ask = async (headers: Record<string, string>, cursor?: string) =>
  (await (
    await post(headers, `/suggestions${cursor ? `?cursor=${cursor}` : ""}`, {})
  ).json()) as SuggestResponse;

test("an empty pantry gets no results; one missing core ingredient shows as a near miss", async () => {
  const user = await signUpWithHousehold("empty@example.com");
  expect((await ask(user)).results).toEqual([]);
  await post(user, "/pantry/items", { text: "lentils", location: "pantry" });
  const answer = await ask(user);
  expect(answer.results).toEqual([]);
  expect(answer.closest.map((c) => c.title)).toEqual(["dal"]);
  expect(answer.closest[0]?.missing_core.map((m) => answer.names[m])).toEqual(["onion"]);
});

test("results are real dishes with a computed reason, six at a time, and the next page does not repeat", async () => {
  const user = await signUpWithHousehold("cook@example.com");
  await post(user, "/pantry/items", { text: "chicken thigh 600g", location: "fridge" });
  const first = await ask(user);
  expect(first.results).toHaveLength(6);
  expect(first.results[0]).toMatchObject({
    reason: "Uses the chicken thigh; works without the leek",
    has_device_variant: false,
  });
  expect(first.results[0]?.missing.map((m) => first.names[m])).toEqual(["leek"]);
  expect(first.next_cursor).toBe(first.run_id);

  // The pantry changes after the first page. The next page still answers for the pantry as it was.
  await post(user, "/pantry/items", { text: "lentils", location: "pantry" });
  await post(user, "/pantry/items", { text: "onion", location: "pantry" });
  const second = await ask(user, first.run_id);
  expect(second.results.map((r) => r.title).sort()).toEqual(
    [
      "chicken-0",
      "chicken-1",
      "chicken-2",
      "chicken-3",
      "chicken-4",
      "chicken-5",
      "chicken-6",
      "chicken-7",
    ]
      .filter((title) => !first.results.some((r) => r.title === title))
      .sort(),
  );
  expect(second.next_cursor).toBeNull();

  const [run] = await db
    .select()
    .from(schema.suggestionRuns)
    .where(eq(schema.suggestionRuns.id, first.run_id));
  expect(run?.results).toHaveLength(8);
  expect(run?.pantry_snapshot).toHaveLength(1);
  const [counter] = await db
    .select()
    .from(schema.usageCounters)
    .where(eq(schema.usageCounters.household_id, run?.household_id ?? ""));
  expect(counter).toMatchObject({ meter: "suggestions", used: 1 });
});

test("another household cannot page through a run that is not its own", async () => {
  const a = await signUpWithHousehold("run-a@example.com");
  const b = await signUpWithHousehold("run-b@example.com");
  await post(a, "/pantry/items", { text: "chicken thigh", location: "fridge" });
  const run = await ask(a);
  expect((await post(b, `/suggestions?cursor=${run.run_id}`, {})).status).toBe(404);
});
