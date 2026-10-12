import { afterAll, expect, test } from "bun:test";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

const [recipe] = await db
  .insert(schema.recipes)
  .values({ slug: "test-stew", status: "auto_reviewed" })
  .returning();
if (!recipe) throw new Error("no recipe");
const [version] = await db
  .insert(schema.recipeVersions)
  .values({
    recipe_id: recipe.id,
    version: 1,
    title: "Test <Stew>",
    cuisine: "testland",
    dish_type: "main",
    primary_protein: "pulse",
    technique: "braise",
    time_total_min: 40,
    time_active_min: 10,
    difficulty: 1,
    base_servings: 4,
    description: "A stew.",
    steps: [{ index: 0, lane: "main", kind: "pan", text: "Simmer.", minutes: 40 }],
    provenance: { references: [], writer_model: "w", reviewer: "r", notes: null },
  })
  .returning();
if (!version) throw new Error("no version");
await db
  .update(schema.recipes)
  .set({ current_version_id: version.id })
  .where(eq(schema.recipes.id, recipe.id));

const { server, signUp, signUpWithHousehold } = createTestServer(db, {
  ownerEmails: ["owner@example.com"],
});
const auth = await signUpWithHousehold("owner@example.com");

test("the review pages send a visitor with no session to the sign-in page", async () => {
  const res = await server.request("/admin/recipes");
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/admin/login");
});

test("the review pages refuse a signed-in user whose household is not on the owner plan", async () => {
  const other = await signUpWithHousehold("cook@example.com");
  expect((await server.request("/admin/recipes", { headers: other })).status).toBe(303);
  const none = await signUp("nobody@example.com");
  expect((await server.request("/admin/recipes", { headers: none })).status).toBe(303);
});

test("the sign-in form lets the owner in and nobody else", async () => {
  const post = (email: string, password: string) =>
    server.request("http://localhost/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: new URLSearchParams({ email, password }).toString(),
    });
  expect((await post("owner@example.com", "wrong password here")).status).toBe(401);
  expect((await post("cook@example.com", "correct horse battery")).status).toBe(401);
  const ok = await post("owner@example.com", "correct horse battery");
  expect(ok.status).toBe(303);
  const cookie = ok.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect((await server.request("/admin/recipes", { headers: { cookie } })).status).toBe(200);
});

test("the list shows a recipe and escapes its title", async () => {
  const res = await server.request("/admin/recipes", { headers: auth });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("Test &lt;Stew&gt;");
  expect(body).not.toContain("Test <Stew>");
});

test("a person can promote a recipe, and cannot set a pipeline status", async () => {
  const post = (status: string, headers: Record<string, string> = {}) =>
    server.request("/admin/recipes/test-stew/status", {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: `status=${status}`,
    });
  expect((await post("draft")).status).toBe(400);
  expect((await post("test_cooked")).status).toBe(303);
  const [row] = await db.select().from(schema.recipes).where(eq(schema.recipes.slug, "test-stew"));
  expect(row?.status).toBe("test_cooked");
});

test("a form posted from another site is refused", async () => {
  const res = await server.request("http://localhost/admin/recipes/test-stew/status", {
    method: "POST",
    headers: {
      ...auth,
      "Content-Type": "application/x-www-form-urlencoded",
      origin: "https://evil.example",
    },
    body: "status=hidden",
  });
  expect(res.status).toBe(403);
});
