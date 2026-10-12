import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { Llm } from "@snapcook/llm";
import type { Me } from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";
import { failSnap } from "../snaps/service";
import { PLANS } from "./plans";
import { consume } from "./usage";

const { db, pool } = await createTestDb();
const snapDir = await mkdtemp(join(tmpdir(), "billing-"));
afterAll(async () => {
  await pool.end();
  await rm(snapDir, { recursive: true });
});

const SECRET = "store-secret";
const { server, signUpWithHousehold } = createTestServer(db, {
  ownerEmails: ["launch@example.com"],
  billingWebhookSecret: SECRET,
  snaps: { snapDir, enqueueDetect: async () => {} },
  llm: {} as Llm,
});
const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const me = async (headers: Record<string, string>) =>
  (await (await call(headers, "GET", "/me")).json()) as Me;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const snap = (headers: Record<string, string>) => {
  const form = new FormData();
  form.set("photo", new File([JPEG], "photo.jpg", { type: "image/jpeg" }));
  form.set("location", "fridge");
  return server.request("/api/v1/snaps", { method: "POST", headers, body: form });
};
const event = (
  type: string,
  app_user_id: string,
  over: Record<string, unknown> = {},
  secret = SECRET,
) =>
  server.request("/api/v1/webhooks/revenuecat", {
    method: "POST",
    headers: { authorization: secret, "content-type": "application/json" },
    body: JSON.stringify({
      event: {
        type,
        app_user_id,
        entitlement_ids: ["pro"],
        event_timestamp_ms: Date.now(),
        ...over,
      },
    }),
  });

test("a free household's snaps stop at the limit, and a failed detection gives one back", async () => {
  const user = await signUpWithHousehold("free@example.com");
  const limit = PLANS.free.meters.snaps ?? 0;
  const ids: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const res = await snap(user);
    expect(res.status).toBe(201);
    ids.push(((await res.json()) as { snap_id: string }).snap_id);
  }
  const refused = await snap(user);
  expect(refused.status).toBe(429);
  const body = (await refused.json()) as {
    error: { code: string; details: { limit: number; used: number; resets_at: string } };
  };
  expect(body.error).toMatchObject({ code: "allowance_exceeded", details: { limit, used: limit } });
  expect(new Date(body.error.details.resets_at).getUTCDate()).toBe(1);
  expect((await me(user)).entitlements?.snaps).toMatchObject({ limit, used: limit });

  await failSnap(db, ids[0] ?? "");
  expect((await snap(user)).status).toBe(201);
  expect((await snap(user)).status).toBe(429);
});

test("the suggestion limit counts new questions by day, and not the next page", async () => {
  const user = await signUpWithHousehold("asks@example.com");
  const limit = PLANS.free.meters.suggestions ?? 0;
  let run = "";
  for (let i = 0; i < limit; i += 1) {
    const res = await call(user, "POST", "/suggestions", {});
    expect(res.status).toBe(200);
    run = ((await res.json()) as { run_id: string }).run_id;
  }
  expect((await call(user, "POST", "/suggestions", {})).status).toBe(429);
  expect((await call(user, "POST", `/suggestions?cursor=${run}`, {})).status).toBe(200);

  // Tomorrow the count starts again.
  const household = (await me(user)).household;
  if (!household) throw new Error("no household");
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  expect(await consume(db, household, "suggestions", tomorrow)).toBeNull();
});

test("the launch household is not limited like a free one", async () => {
  const user = await signUpWithHousehold("launch@example.com");
  expect((await me(user)).entitlements).toMatchObject({ plan: "owner", adaptation_controls: true });
  for (let i = 0; i < (PLANS.free.meters.suggestions ?? 0) + 2; i += 1) {
    expect((await call(user, "POST", "/suggestions", {})).status).toBe(200);
  }
});

test("store events set the plan: a purchase makes it paid, a cancellation keeps it until expiry", async () => {
  const user = await signUpWithHousehold("buyer@example.com");
  const { user: owner, household } = await me(user);
  const plan = async () => (await me(user)).household?.plan;
  const status = async () =>
    (
      await db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.household_id, household?.id ?? ""))
    )[0]?.status;

  expect((await event("INITIAL_PURCHASE", owner.id, {}, "wrong")).status).toBe(401);
  expect(await plan()).toBe("free");

  await event("INITIAL_PURCHASE", owner.id, { period_type: "TRIAL" });
  expect([await plan(), await status()]).toEqual(["pro", "in_trial"]);
  expect((await me(user)).entitlements).toMatchObject({
    adaptation_controls: true,
    saved: { limit: null },
  });
  await event("RENEWAL", owner.id, { period_type: "NORMAL" });
  expect(await status()).toBe("active");
  await event("CANCELLATION", owner.id);
  expect([await plan(), await status()]).toEqual(["pro", "cancelled"]);
  await event("BILLING_ISSUE", owner.id);
  expect([await plan(), await status()]).toEqual(["pro", "billing_issue"]);

  const late = Date.now() + 1000;
  await event("EXPIRATION", owner.id, { event_timestamp_ms: late });
  expect([await plan(), await status()]).toEqual(["free", "expired"]);
  // An older event that arrives after a newer one changes nothing.
  await event("RENEWAL", owner.id, { event_timestamp_ms: late - 500 });
  expect([await plan(), await status()]).toEqual(["free", "expired"]);
});

test("a store event never changes a plan set by hand, and unknown events are acknowledged", async () => {
  const user = await signUpWithHousehold("launch2@example.com");
  const { user: owner, household } = await me(user);
  await db
    .update(schema.households)
    .set({ plan: "owner" })
    .where(eq(schema.households.id, household?.id ?? ""));
  await event("EXPIRATION", owner.id);
  expect((await me(user)).household?.plan).toBe("owner");
  const res = await event("TEST", owner.id);
  expect(await res.json()).toEqual({ handled: false });
  expect(await (await event("RENEWAL", "018f4b7a-0000-7000-8000-000000000000")).json()).toEqual({
    handled: false,
  });
});
