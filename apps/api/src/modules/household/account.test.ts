import { afterAll, expect, test } from "bun:test";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { InviteView, Me } from "@snapcook/schema";
import { eq, inArray } from "drizzle-orm";
import { createTestServer } from "../../testing";
import { canSee, sourceOf } from "../recipes/visibility";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());
const { server, signUp, signUpWithHousehold } = createTestServer(db);
const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const meOf = async (headers: Record<string, string>) =>
  (await (await call(headers, "GET", "/me")).json()) as Me;

test("an owner deletes their account only as the last member; a member's deletion keeps the household", async () => {
  const owner = await signUpWithHousehold("keeper@example.com");
  const { code } = (await (await call(owner, "POST", "/household/invites")).json()) as InviteView;
  const guest = await signUp("visitor@example.com");
  await call(guest, "POST", "/household/join", { code });

  const refused = await call(owner, "DELETE", "/me");
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { error: { details: unknown } }).error.details).toEqual({
    reason: "has_members",
  });

  expect((await call(guest, "DELETE", "/me")).status).toBe(204);
  expect((await call(guest, "GET", "/me")).status).toBe(401);
  const left = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, "visitor@example.com"));
  expect(left).toEqual([]);
  expect((await meOf(owner)).household).not.toBeNull();
});

test("the last member's deletion takes the household and its recipes, but keeps a shared recipe others use", async () => {
  const leaving = await signUpWithHousehold("leaving@example.com");
  const other = await signUpWithHousehold("staying@example.com");
  const leavingId = (await meOf(leaving)).household?.id as string;
  const otherId = (await meOf(other)).household?.id as string;
  const [priv, shared, unused] = await db
    .insert(schema.recipes)
    .values([
      { slug: "leaving-private", status: "auto_reviewed", household_id: leavingId },
      {
        slug: "leaving-shared",
        status: "auto_reviewed",
        household_id: leavingId,
        shared_at: new Date(),
      },
      {
        slug: "leaving-shared-unused",
        status: "auto_reviewed",
        household_id: leavingId,
        shared_at: new Date(),
      },
    ])
    .returning();
  if (!priv || !shared || !unused) throw new Error("no recipes");
  await db.insert(schema.savedRecipes).values({ household_id: otherId, recipe_id: shared.id });

  expect((await call(leaving, "DELETE", "/me")).status).toBe(204);

  const rows = await db
    .select()
    .from(schema.recipes)
    .where(inArray(schema.recipes.id, [priv.id, shared.id, unused.id]));
  expect(rows.map((r) => r.slug)).toEqual(["leaving-shared"]);
  const [kept] = rows;
  if (!kept) throw new Error("no recipe kept");
  expect(kept.household_id).toBeNull();
  expect(kept.orphaned_at).not.toBeNull();
  // It is still a community recipe to everyone else, not an official one.
  expect(canSee(kept, otherId)).toBe(true);
  expect(sourceOf(kept, otherId)).toBe("community");
  expect(
    await db.select().from(schema.households).where(eq(schema.households.id, leavingId)),
  ).toEqual([]);
});
