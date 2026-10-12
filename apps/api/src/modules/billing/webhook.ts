import { timingSafeEqual } from "node:crypto";
import { type Db, schema } from "@snapcook/db";
import type { SubscriptionStatus } from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fail } from "../../http";

const { households, subscriptions } = schema;

/** The part of a store event this API reads. Everything else is kept as received. */
const StoreEvent = z.object({
  event: z.looseObject({
    type: z.string(),
    app_user_id: z.string().optional(),
    entitlement_ids: z.array(z.string()).nullish(),
    expiration_at_ms: z.number().nullish(),
    period_type: z.string().nullish(),
    event_timestamp_ms: z.number().optional(),
  }),
});

// What each event means for the subscription, and whether the household keeps its paid plan.
const MEANING: Record<string, { status: SubscriptionStatus | "by_period"; paid: boolean }> = {
  INITIAL_PURCHASE: { status: "by_period", paid: true },
  RENEWAL: { status: "by_period", paid: true },
  PRODUCT_CHANGE: { status: "by_period", paid: true },
  UNCANCELLATION: { status: "by_period", paid: true },
  // Renewal is off, but what was paid for runs to its end.
  CANCELLATION: { status: "cancelled", paid: true },
  // The store is still retrying the payment.
  BILLING_ISSUE: { status: "billing_issue", paid: true },
  EXPIRATION: { status: "expired", paid: false },
};

function sameSecret(given: string | undefined, secret: string) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Receives subscription events from the store service and sets the household's plan. The app
 * user id of an event is the id of the household's owner.
 */
export function billingWebhook(db: Db, secret: string | undefined) {
  return new Hono().post("/webhooks/revenuecat", async (c) => {
    // With no secret configured, the route does not exist.
    if (!secret) return c.notFound();
    const given = c.req.header("authorization")?.replace(/^Bearer /, "");
    if (!sameSecret(given, secret)) return fail(c, 401, "unauthenticated", "Wrong secret.");
    const parsed = StoreEvent.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return fail(c, 400, "validation", "Not a store event.");
    const { event } = parsed.data;
    const meaning = MEANING[event.type];
    // Test events, transfers and kinds added later are acknowledged and change nothing.
    if (!meaning || !event.app_user_id) return c.json({ handled: false });

    const handled = await db.transaction(async (tx) => {
      const [household] = await tx
        .select()
        .from(households)
        .where(eq(households.owner_user_id, event.app_user_id ?? ""))
        .for("update");
      if (!household) return false;
      const [current] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.household_id, household.id));
      // Events can arrive out of order. An older one never replaces a newer one.
      const seen = Number(
        (current?.raw as { event_timestamp_ms?: number } | undefined)?.event_timestamp_ms ?? 0,
      );
      if (event.event_timestamp_ms !== undefined && event.event_timestamp_ms < seen) return true;

      const status =
        meaning.status === "by_period"
          ? event.period_type === "TRIAL"
            ? "in_trial"
            : "active"
          : meaning.status;
      const row = {
        rc_app_user_id: event.app_user_id ?? "",
        entitlement: event.entitlement_ids?.[0] ?? null,
        status,
        expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms) : null,
        raw: event as Record<string, unknown>,
        updated_at: new Date(),
      };
      await tx
        .insert(subscriptions)
        .values({ household_id: household.id, ...row })
        .onConflictDoUpdate({ target: subscriptions.household_id, set: row });
      // A plan set by hand is never touched by the store.
      if (household.plan !== "owner") {
        await tx
          .update(households)
          .set({ plan: meaning.paid ? "pro" : "free" })
          .where(eq(households.id, household.id));
      }
      return true;
    });
    return c.json({ handled });
  });
}
