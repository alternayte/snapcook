import { z } from "zod";
import { DeviceStep } from "./corpus";
import { DeviceProfileId, Effort, Id, Location, Quantity, RecipeSource, Unit } from "./enums";

export const SuggestRequest = z.object({
  time_budget_min: z.number().int().positive(),
  servings: z.number().positive().multipleOf(0.5),
  effort: Effort,
  use_up: z.array(Id),
  craving: z.string().nullable(),
  mc_only: z.boolean(),
  /** Leaves community recipes out. Runs stored before this existed have none. */
  official_only: z.boolean().optional(),
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

/** A pantry item as it was before a cook used it up, so removing the cook can put it back. */
export const RemovedItem = z.object({
  id: Id,
  ingredient_id: Id.nullable(),
  display_name: z.string().min(1),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  location: Location,
  use_soon: z.boolean(),
  expires_on: z.iso.date().nullable(),
});
export type RemovedItem = z.infer<typeof RemovedItem>;

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
  /** Who cooked. Null once that person deleted their account. */
  user_id: Id.nullable(),
  adaptation_id: Id,
  started_at: z.date(),
  finished_at: z.date().nullable(),
  current_step: z.number().int().nonnegative(),
  deductions: z.array(Deduction).nullable(),
  /** Pantry items the finish removed, as they were before. */
  removed_items: z.array(RemovedItem).nullable(),
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
  source: RecipeSource,
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
  source: RecipeSource,
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

/** A recipe as written, before it is adapted to a household. */
export const RecipeView = z.object({
  recipe_id: Id,
  recipe_version_id: Id,
  title: z.string(),
  description: z.string(),
  cuisine: z.string(),
  time_total_min: z.number().int(),
  time_active_min: z.number().int(),
  difficulty: z.number().int(),
  base_servings: z.number().int(),
  image: z.string().nullable(),
  /** True when the dish has steps for the device. */
  has_device_variant: z.boolean(),
  source: RecipeSource,
  /** For this household's own recipe: private, shared, or removed from the community list. */
  sharing: z.enum(["private", "shared", "removed"]).nullable(),
  ingredients: z.array(
    z.object({
      ingredient_id: Id,
      name: z.string(),
      quantity: Quantity.nullable(),
      unit: Unit.nullable(),
      prep: z.string().nullable(),
      role: z.enum(["core", "supporting", "staple", "optional"]),
    }),
  ),
  steps: z.array(DeviceStep),
});
export type RecipeView = z.infer<typeof RecipeView>;

export const AdaptRequest = z.object({
  recipe_version_id: Id,
  /** Any control left out takes the household's default. */
  controls: AdaptationControls.partial(),
});
export type AdaptRequest = z.infer<typeof AdaptRequest>;

export const AdaptResponse = z.object({
  adaptation_id: Id,
  controls: AdaptationControls,
  /** True when the household's plan does not let it change the controls. */
  controls_locked: z.boolean(),
  recipe: AdaptedRecipe,
  /** For each ingredient that is not on hand, the pantry items that could stand in for it. */
  swap_options: z.record(Id, z.array(z.object({ pantry_item_id: Id, name: z.string() }))),
});
export type AdaptResponse = z.infer<typeof AdaptResponse>;

export const StartCookInput = z.object({ adaptation_id: Id });
export const CookProgressInput = z.object({ current_step: z.number().int().nonnegative() });

/** How a cook ends: what it used, what ran out, and how it went. */
export const FinishCookInput = z.object({
  /** What to take from the pantry. Empty when the household skips the update. */
  deductions: z.array(Deduction),
  /** Pantry items kept as "some" that the household says are now used up. */
  gone: z.array(Id).default([]),
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type FinishCookInput = z.infer<typeof FinishCookInput>;

/** A pantry item that ran out in a cook, for the client to offer to the shopping list. */
export const UsedUp = z.object({ ingredient_id: Id.nullable(), display_name: z.string() });

export const FinishCookResponse = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("finished"),
    applied: z.array(Deduction),
    used_up: z.array(UsedUp),
  }),
  // Nothing was changed: these deductions have no conversion into their pantry item's unit.
  z.object({ outcome: z.literal("needs_input"), needs_input: z.array(Deduction) }),
]);
export type FinishCookResponse = z.infer<typeof FinishCookResponse>;

/** A cook as the app shows it: the session, and the recipe exactly as it was cooked. */
export const CookView = z.object({
  id: Id,
  recipe_id: Id,
  recipe_version_id: Id,
  title: z.string(),
  image: z.string().nullable(),
  started_at: z.date(),
  finished_at: z.date().nullable(),
  current_step: z.number().int(),
  rating: z.number().int().nullable(),
  recipe: AdaptedRecipe,
  /** Pantry items in the recipe's deductions that have no amount: the client asks about each. */
  confirm_still_have: z.array(z.object({ pantry_item_id: Id, display_name: z.string() })),
  /** The pantry item behind each deduction, for the finish sheet. */
  items: z.record(
    Id,
    z.object({ display_name: z.string(), quantity: Quantity.nullable(), unit: Unit.nullable() }),
  ),
});
export type CookView = z.infer<typeof CookView>;

export const RescueInput = z.object({
  step_index: z.number().int().nonnegative(),
  text: z.string().trim().min(3).max(300),
});
export const RescueResponse = z.object({
  answer: z.string(),
  /** Whether the answer is a stored fix for this dish or was written for this question. */
  source: z.enum(["known_fix", "model"]),
});
export type RescueResponse = z.infer<typeof RescueResponse>;
