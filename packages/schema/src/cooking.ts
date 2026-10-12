import { z } from "zod";
import { DeviceStep } from "./corpus";
import { DeviceProfileId, Effort, Id, Quantity, Unit } from "./enums";

export const SuggestRequest = z.object({
  time_budget_min: z.number().int().positive(),
  servings: z.number().positive().multipleOf(0.5),
  effort: Effort,
  use_up: z.array(Id),
  craving: z.string().nullable(),
  mc_only: z.boolean(),
});
export type SuggestRequest = z.infer<typeof SuggestRequest>;

export const PantrySnapshotLine = z.object({
  ingredient_id: Id,
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  use_soon: z.boolean(),
});
export type PantrySnapshotLine = z.infer<typeof PantrySnapshotLine>;

export const SuggestionResult = z.object({
  recipe_version_id: Id,
  score: z.number(),
  have: z.array(Id),
  missing: z.array(Id),
  substituted: z.array(z.object({ ingredient_id: Id, substitute_id: Id })),
  uses_use_soon: z.array(Id),
  reason: z.string(),
});
export type SuggestionResult = z.infer<typeof SuggestionResult>;

export const SuggestionRun = z.object({
  id: Id,
  household_id: Id,
  request: SuggestRequest,
  pantry_snapshot: z.array(PantrySnapshotLine),
  results: z.array(SuggestionResult),
  created_at: z.date(),
});
export type SuggestionRun = z.infer<typeof SuggestionRun>;

export const AdaptationControls = z.object({
  servings: z.number().positive().multipleOf(0.5),
  device_profile_id: DeviceProfileId.nullable(),
  swaps: z.array(z.object({ ingredient_id: Id, pantry_item_id: Id })),
  toddler_safe: z.boolean(),
  lazier: z.boolean(),
});
export type AdaptationControls = z.infer<typeof AdaptationControls>;

export const Deduction = z.object({ pantry_item_id: Id, quantity: Quantity, unit: Unit });
export type Deduction = z.infer<typeof Deduction>;

export const AdaptedIngredient = z.object({
  ingredient_id: Id,
  display: z.string().min(1),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  status: z.enum(["in_pantry", "staple", "substituted", "missing"]),
  substituted_for: Id.optional(),
  pantry_item_id: Id.optional(),
});
export type AdaptedIngredient = z.infer<typeof AdaptedIngredient>;

export const AdaptedRecipe = z.object({
  servings: z.number().positive(),
  ingredients: z.array(AdaptedIngredient),
  steps: z.array(DeviceStep),
  deductions: z.array(Deduction),
  tips: z.array(z.string()),
  toddler_notes: z.array(z.string()),
  refused: z.object({ control: z.string(), reason: z.string() }).optional(),
});
export type AdaptedRecipe = z.infer<typeof AdaptedRecipe>;

export const Adaptation = z.object({
  id: Id,
  household_id: Id,
  recipe_version_id: Id,
  input_hash: z.string().regex(/^[0-9a-f]{64}$/),
  controls: AdaptationControls,
  output: AdaptedRecipe,
  model: z.string().min(1),
  cost_usd: z.number().nonnegative(),
  created_at: z.date(),
});
export type Adaptation = z.infer<typeof Adaptation>;

export const CookSession = z.object({
  id: Id,
  household_id: Id,
  user_id: Id,
  adaptation_id: Id,
  started_at: z.date(),
  finished_at: z.date().nullable(),
  current_step: z.number().int().nonnegative(),
  deductions: z.array(Deduction).nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  notes: z.string().nullable(),
});
export type CookSession = z.infer<typeof CookSession>;

/** What the client sends: any part of the request it wants to override. The profile fills the rest. */
export const SuggestInput = SuggestRequest.partial().extend({
  craving: z.string().trim().max(80).nullable().optional(),
});
export type SuggestInput = z.infer<typeof SuggestInput>;

/** One suggested dish with what a result card shows. */
export const SuggestionCard = SuggestionResult.extend({
  recipe_id: Id,
  title: z.string(),
  cuisine: z.string(),
  time_total_min: z.number().int(),
  time_active_min: z.number().int(),
  difficulty: z.number().int(),
  has_device_variant: z.boolean(),
  /** File name of the dish picture, or null when the recipe has none. */
  image: z.string().nullable(),
  /** Ingredients the household would rather not eat that this dish uses. */
  disliked: z.array(Id),
});
export type SuggestionCard = z.infer<typeof SuggestionCard>;

/** A dish the household cannot make yet, and the one or two core ingredients it lacks. */
export const NearMiss = z.object({
  recipe_version_id: Id,
  recipe_id: Id,
  title: z.string(),
  image: z.string().nullable(),
  missing_core: z.array(Id),
});
export type NearMiss = z.infer<typeof NearMiss>;

export const SuggestResponse = z.object({
  run_id: Id,
  results: z.array(SuggestionCard),
  closest: z.array(NearMiss),
  /** The name of every ingredient id in this response. */
  names: z.record(Id, z.string()),
  /** Send this back to get the next results of the same run. Null when there are no more. */
  next_cursor: z.string().nullable(),
});
export type SuggestResponse = z.infer<typeof SuggestResponse>;
