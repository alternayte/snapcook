import { z } from "zod";
import { Id, Meter, SubscriptionStatus } from "./enums";

/** A calendar month `YYYY-MM` or a calendar day `YYYY-MM-DD`. */
export const UsagePeriod = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/);

export const UsageCounter = z.object({
  household_id: Id,
  period: UsagePeriod,
  meter: Meter,
  used: z.number().int().nonnegative(),
});
export type UsageCounter = z.infer<typeof UsageCounter>;

export const Subscription = z.object({
  household_id: Id,
  rc_app_user_id: z.string().min(1),
  entitlement: z.string().nullable(),
  status: SubscriptionStatus,
  expires_at: z.date().nullable(),
  raw: z.record(z.string(), z.unknown()),
  updated_at: z.date(),
});
export type Subscription = z.infer<typeof Subscription>;

export const LlmCall = z.object({
  id: Id,
  household_id: Id.nullable(),
  endpoint: z.string().min(1),
  model: z.string().min(1),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  ok: z.boolean(),
  created_at: z.date(),
});
export type LlmCall = z.infer<typeof LlmCall>;

/** What one model call reports for the log, before it has an id or a timestamp. */
export const LlmCallRecord = LlmCall.omit({ id: true, created_at: true });
export type LlmCallRecord = z.infer<typeof LlmCallRecord>;

/** What one household's model calls cost on one day. */
export const HouseholdCostDaily = z.object({
  household_id: Id,
  day: z.iso.date(),
  cost_usd: z.number().nonnegative(),
  calls: z.number().int().nonnegative(),
});
export type HouseholdCostDaily = z.infer<typeof HouseholdCostDaily>;
