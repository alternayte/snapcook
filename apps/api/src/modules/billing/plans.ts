import type { Meter, Plan } from "@snapcook/schema";

export type Limits = {
  /** The most uses of each meter in its period. Null means no limit. */
  meters: Record<Meter, number | null>;
  /** The most people in the household, the owner included. */
  members: number;
  /** The most saved recipes. Null means no limit. */
  saved: number | null;
  /** Whether the household may change how a recipe is adapted. */
  adaptationControls: boolean;
  /** The most model cost in a calendar month, in US dollars, before metered routes stop. Null means none. */
  monthlyCostUsd: number | null;
};

/** The period each meter counts over. */
export const PERIOD: Record<Meter, "day" | "month"> = {
  snaps: "month",
  suggestions: "day",
  adaptations: "month",
  rescues: "month",
  imports: "month",
};

const PAID: Limits = {
  // A paid household has no stated limit. The snap figure is a fair-use ceiling.
  meters: { snaps: 300, suggestions: null, adaptations: null, rescues: null, imports: 30 },
  members: 5,
  saved: null,
  adaptationControls: true,
  monthlyCostUsd: 3.3,
};

/** Everything a plan allows. A change of allowance is an edit here and nowhere else. */
export const PLANS: Record<Plan, Limits> = {
  free: {
    meters: { snaps: 10, suggestions: 3, adaptations: null, rescues: null, imports: 3 },
    members: 2,
    saved: 20,
    adaptationControls: false,
    monthlyCostUsd: 3.3,
  },
  pro: PAID,
  // The launch household and friends: paid allowances with no billing and no cost stop.
  owner: { ...PAID, meters: { ...PAID.meters, imports: null }, monthlyCostUsd: null },
};
