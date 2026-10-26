import { type Db, schema } from "@snapcook/db";
import type { Entitlements, Household, Meter } from "@snapcook/schema";
import { and, eq, sql } from "drizzle-orm";
import { PERIOD, PLANS } from "./plans";

const { householdMembers, savedRecipes, usageCounters } = schema;

/** The counter period a moment falls in: `YYYY-MM-DD` for a daily meter, `YYYY-MM` for a monthly one. */
export const periodOf = (meter: Meter, at: Date) =>
  at.toISOString().slice(0, PERIOD[meter] === "day" ? 10 : 7);

/** When the meter's current period ends, in UTC. */
export function resetsAt(meter: Meter, at: Date) {
  return PERIOD[meter] === "day"
    ? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1))
    : new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

export type Refusal = { limit: number; used: number; resets_at: Date };

/** Thrown where a refusal has to travel up through code that does not return it. */
export class AllowanceUsedUp extends Error {
  constructor(readonly refusal: Refusal) {
    super("the plan's allowance is used up");
  }
}

async function used(db: Db, householdId: string, meter: Meter, at: Date) {
  const [row] = await db
    .select({ used: usageCounters.used })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.household_id, householdId),
        eq(usageCounters.period, periodOf(meter, at)),
        eq(usageCounters.meter, meter),
      ),
    );
  return row?.used ?? 0;
}

async function costThisMonth(db: Db, householdId: string, at: Date) {
  const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const result = await db.execute<{ cost: number | null }>(
    sql`select sum(cost_usd)::float8 as cost from llm_calls
        where household_id = ${householdId} and created_at >= ${from}`,
  );
  return result.rows[0]?.cost ?? 0;
}

/**
 * Counts one use of a meter, unless the household's plan has none left. The check and the count
 * are one statement, so two requests at once cannot both take the last one.
 */
export async function consume(
  db: Db,
  household: Pick<Household, "id" | "plan">,
  meter: Meter,
  at = new Date(),
): Promise<Refusal | null> {
  const plan = PLANS[household.plan];
  const limit = plan.meters[meter];
  const resets_at = resetsAt(meter, at);
  if (limit !== null && limit <= 0) return { limit, used: 0, resets_at };
  // A household whose model cost has passed the stop is held until a person looks at it.
  if (plan.monthlyCostUsd !== null) {
    const cost = await costThisMonth(db, household.id, at);
    if (cost >= plan.monthlyCostUsd) {
      return {
        limit: limit ?? 0,
        used: await used(db, household.id, meter, at),
        resets_at: resetsAt("snaps", at),
      };
    }
  }
  const counted = await db
    .insert(usageCounters)
    .values({ household_id: household.id, period: periodOf(meter, at), meter, used: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.household_id, usageCounters.period, usageCounters.meter],
      set: { used: sql`${usageCounters.used} + 1` },
      setWhere: limit === null ? undefined : sql`${usageCounters.used} < ${limit}`,
    })
    .returning({ used: usageCounters.used });
  if (counted.length > 0 || limit === null) return null;
  return { limit, used: await used(db, household.id, meter, at), resets_at };
}

/** Gives one use back, in the period it was counted in. */
export async function release(db: Db, householdId: string, meter: Meter, countedAt: Date) {
  await db
    .update(usageCounters)
    .set({ used: sql`greatest(${usageCounters.used} - 1, 0)` })
    .where(
      and(
        eq(usageCounters.household_id, householdId),
        eq(usageCounters.period, periodOf(meter, countedAt)),
        eq(usageCounters.meter, meter),
      ),
    );
}

export const memberCount = async (db: Db, householdId: string) =>
  db.$count(householdMembers, eq(householdMembers.household_id, householdId));

export const savedCount = async (db: Db, householdId: string) =>
  db.$count(savedRecipes, eq(savedRecipes.household_id, householdId));

/** What the household may do and how much of it is left, for the app to show before a limit is hit. */
export async function entitlements(
  db: Db,
  household: Household,
  at = new Date(),
): Promise<Entitlements> {
  const plan = PLANS[household.plan];
  const meterState = async (meter: "snaps" | "suggestions" | "imports") => ({
    limit: plan.meters[meter],
    used: await used(db, household.id, meter, at),
    resets_at: resetsAt(meter, at),
  });
  return {
    plan: household.plan,
    snaps: await meterState("snaps"),
    suggestions: await meterState("suggestions"),
    imports: await meterState("imports"),
    members: { limit: plan.members, used: await memberCount(db, household.id) },
    saved: { limit: plan.saved, used: await savedCount(db, household.id) },
    adaptation_controls: plan.adaptationControls,
  };
}
