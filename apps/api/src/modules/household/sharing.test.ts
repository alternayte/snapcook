import { afterAll, expect, test } from "bun:test";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { InviteView, Me, MemberView, PantryItem } from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";
import { joinHousehold } from "./sharing";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());
// One household is on the owner plan, which has room for more than two people.
const { server, signUp, signUpWithHousehold } = createTestServer(db, {
  ownerEmails: ["boss@example.com"],
});
const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const invite = async (owner: Record<string, string>) =>
  (await (await call(owner, "POST", "/household/invites")).json()) as InviteView;
const meOf = async (headers: Record<string, string>) =>
  (await (await call(headers, "GET", "/me")).json()) as Me;

test("a code lets one person join, and they then share the household's pantry", async () => {
  const owner = await signUpWithHousehold("owner@example.com");
  await call(owner, "POST", "/pantry/items", { text: "milk", location: "fridge" });
  const { code } = await invite(owner);
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  const guest = await signUp("guest@example.com");
  // The code is typed in lower case; it still works.
  const joined = (await (
    await call(guest, "POST", "/household/join", { code: code.toLowerCase() })
  ).json()) as Me;
  expect(joined.role).toBe("member");
  expect(joined.household?.id).toBe((await meOf(owner)).household?.id);
  const pantry = ((await (await call(guest, "GET", "/pantry")).json()) as { items: PantryItem[] })
    .items;
  expect(pantry.map((i) => i.display_name)).toEqual(["milk"]);

  // The same code does not work for a second person.
  const late = await signUp("late@example.com");
  expect((await call(late, "POST", "/household/join", { code })).status).toBe(404);
  const list = (
    (await (await call(owner, "GET", "/household/members")).json()) as { members: MemberView[] }
  ).members;
  expect(list.map((m) => [m.email, m.role])).toEqual([
    ["owner@example.com", "owner"],
    ["guest@example.com", "member"],
  ]);
});

test("a person who has a household cannot join another, and an old code does not work", async () => {
  const a = await signUpWithHousehold("a@example.com");
  const b = await signUpWithHousehold("b@example.com");
  const { code } = await invite(a);
  const res = await call(b, "POST", "/household/join", { code });
  expect(res.status).toBe(403);
  expect(
    ((await res.json()) as { error: { details: { reason: string } } }).error.details.reason,
  ).toBe("already_in_household");

  const guest = await signUp("slow@example.com");
  const guestId = (await meOf(guest)).user.id;
  const eightDays = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  expect(await joinHousehold(db, guestId, code, eightDays)).toBe("bad_code");
});

test("the owner can remove a member, who then has no household; a member can only leave", async () => {
  const owner = await signUpWithHousehold("boss@example.com");
  const one = await signUp("one@example.com");
  const two = await signUp("two@example.com");
  await call(one, "POST", "/household/join", { code: (await invite(owner)).code });
  await call(two, "POST", "/household/join", { code: (await invite(owner)).code });
  const [ownerId, oneId, twoId] = [
    (await meOf(owner)).user.id,
    (await meOf(one)).user.id,
    (await meOf(two)).user.id,
  ];

  // A member cannot remove another member or the owner. The owner cannot be removed at all.
  expect((await call(one, "DELETE", `/household/members/${twoId}`)).status).toBe(403);
  expect((await call(one, "DELETE", `/household/members/${ownerId}`)).status).toBe(403);
  expect((await call(owner, "DELETE", `/household/members/${ownerId}`)).status).toBe(403);

  expect((await call(owner, "DELETE", `/household/members/${oneId}`)).status).toBe(204);
  expect((await meOf(one)).household).toBeNull();
  expect((await call(one, "GET", "/pantry")).status).toBe(403);

  expect((await call(two, "DELETE", `/household/members/${twoId}`)).status).toBe(204);
  expect((await meOf(two)).household).toBeNull();
  const left = await db
    .select()
    .from(schema.householdMembers)
    .where(eq(schema.householdMembers.user_id, ownerId));
  expect(left).toHaveLength(1);
});

test("a member of another household cannot remove someone from this one", async () => {
  const owner = await signUpWithHousehold("home@example.com");
  const guest = await signUp("member@example.com");
  await call(guest, "POST", "/household/join", { code: (await invite(owner)).code });
  const outsider = await signUpWithHousehold("outsider@example.com");
  expect(
    (await call(outsider, "DELETE", `/household/members/${(await meOf(guest)).user.id}`)).status,
  ).toBe(404);
});

test("a household on the free plan has room for the owner and one more", async () => {
  const owner = await signUpWithHousehold("small@example.com");
  const first = await signUp("first@example.com");
  const second = await signUp("second@example.com");
  expect(
    (await call(first, "POST", "/household/join", { code: (await invite(owner)).code })).status,
  ).toBe(200);
  const res = await call(second, "POST", "/household/join", { code: (await invite(owner)).code });
  expect(res.status).toBe(403);
  expect(
    ((await res.json()) as { error: { details: { reason: string } } }).error.details.reason,
  ).toBe("household_full");
});
