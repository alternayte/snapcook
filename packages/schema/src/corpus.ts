import { z } from "zod";
import {
  Allergen,
  CandidateStatus,
  DeviceProfileId,
  Embedding,
  Id,
  IngredientCategory,
  IngredientRole,
  Quantity,
  RecipeStatus,
  ReportKind,
  SubstituteContext,
  Suitability,
  Unit,
} from "./enums";

export const Ingredient = z.object({
  id: Id,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  category: IngredientCategory,
  allergens: z.array(Allergen),
  default_unit: Unit,
  /** Grams in one piece. Set for every ingredient that is counted. */
  grams_per_unit: z.number().positive().nullable(),
  /** Millilitres that one gram occupies. Null means 1, as for water. */
  ml_per_unit: z.number().positive().nullable(),
  is_staple_default: z.boolean(),
  embedding: Embedding.nullable(),
});
export type Ingredient = z.infer<typeof Ingredient>;

export const IngredientSubstitute = z.object({
  ingredient_id: Id,
  substitute_id: Id,
  context: SubstituteContext,
  note: z.string().nullable(),
});
export type IngredientSubstitute = z.infer<typeof IngredientSubstitute>;

export const McAccessory = z.enum(["steam_basket", "butterfly", "cup_off"]);
export type McAccessory = z.infer<typeof McAccessory>;

export const McSettings = z.object({
  temp_c: z.number().int().nonnegative(),
  minutes: z.number().positive(),
  speed: z.number().int().nonnegative(),
  reverse: z.boolean(),
  accessory: McAccessory.optional(),
});
export type McSettings = z.infer<typeof McSettings>;

export const DeviceStep = z.object({
  index: z.number().int().nonnegative(),
  lane: z.enum(["main", "side"]),
  kind: z.enum(["mc", "pan", "oven", "prep", "rest"]),
  text: z.string().min(1),
  minutes: z.number().positive().optional(),
  mc: McSettings.optional(),
});
export type DeviceStep = z.infer<typeof DeviceStep>;

export const FailureMode = z.object({ symptom: z.string().min(1), fix: z.string().min(1) });
export type FailureMode = z.infer<typeof FailureMode>;

export const Provenance = z.object({
  references: z.array(z.object({ url: z.url(), title: z.string(), fetched_at: z.iso.datetime() })),
  writer_model: z.string().nullable(),
  reviewer: z.string().nullable(),
  notes: z.string().nullable(),
});
export type Provenance = z.infer<typeof Provenance>;

export const Recipe = z.object({
  id: Id,
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  status: RecipeStatus,
  current_version_id: Id.nullable(),
});
export type Recipe = z.infer<typeof Recipe>;

export const RecipeVersion = z.object({
  id: Id,
  recipe_id: Id,
  version: z.number().int().positive(),
  title: z.string().min(1),
  cuisine: z.string().min(1),
  dish_type: z.string().min(1),
  primary_protein: z.string().min(1),
  technique: z.string().min(1),
  time_total_min: z.number().int().positive(),
  time_active_min: z.number().int().positive(),
  difficulty: z.number().int().min(1).max(3),
  base_servings: z.number().int().positive(),
  description: z.string(),
  steps: z.array(DeviceStep),
  tags: z.array(z.string().min(1)),
  failure_modes: z.array(FailureMode),
  provenance: Provenance,
  embedding: Embedding.nullable(),
  created_at: z.date(),
});
export type RecipeVersion = z.infer<typeof RecipeVersion>;

export const RecipeIngredient = z.object({
  recipe_version_id: Id,
  ingredient_id: Id,
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  prep: z.string().nullable(),
  role: IngredientRole,
  position: z.number().int().nonnegative(),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredient>;

const Range = z.object({ min: z.number(), max: z.number() });

export const DeviceProgram = z.object({
  temp_c: Range,
  default_temp_c: z.number(),
  speed: z.number().int().nullable(),
  reverse: z.boolean(),
  max_minutes: z.number().positive(),
  max_load_g: z.number().positive().optional(),
});
export type DeviceProgram = z.infer<typeof DeviceProgram>;

export const DeviceCapabilities = z.object({
  temp_c: Range,
  speed: Range,
  reverse_max_speed: z.number().int(),
  whisk_max_speed: z.number().int(),
  /** Longest run time in minutes, by the highest speed it applies to. */
  time_limits: z.array(z.object({ up_to_speed: z.number().int(), max_minutes: z.number() })),
  bowl_max_fill_ml: z.number().positive(),
  high_speed_max_liquid_ml: z.number().positive(),
  scale: z.object({ max_g: z.number().positive(), step_g: z.number().positive() }),
  accessories: z.array(z.string().min(1)),
  programs: z.record(z.string(), DeviceProgram),
});
export type DeviceCapabilities = z.infer<typeof DeviceCapabilities>;

export const DeviceProfile = z.object({
  id: DeviceProfileId,
  name: z.string().min(1),
  capabilities: DeviceCapabilities,
});
export type DeviceProfile = z.infer<typeof DeviceProfile>;

export const RecipeDeviceVariant = z.object({
  recipe_version_id: Id,
  device_profile_id: DeviceProfileId,
  steps: z.array(DeviceStep),
  suitability: Suitability,
  notes: z.string().nullable(),
});
export type RecipeDeviceVariant = z.infer<typeof RecipeDeviceVariant>;

export const RecipeReport = z.object({
  id: Id,
  recipe_version_id: Id,
  household_id: Id,
  kind: ReportKind,
  payload: z.record(z.string(), z.unknown()),
  resolved: z.boolean(),
  created_at: z.date(),
});
export type RecipeReport = z.infer<typeof RecipeReport>;

/** A dish proposed for the catalogue, before a person has pruned the list. */
export const DishCandidate = z.object({
  id: Id,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  cuisine: z.string().min(1),
  dish_type: z.string().min(1),
  primary_protein: z.string().min(1),
  technique: z.string().min(1),
  time_band: z.string().min(1),
  status: CandidateStatus,
  /** The writing batch this dish is assigned to. Null until it is selected. */
  batch: z.number().int().positive().nullable(),
  /** The recipe this dish became, once a draft passed review. */
  recipe_id: Id.nullable(),
  /** An earlier candidate this one closely resembles, for the person pruning to judge. */
  similar_to: Id.nullable(),
  embedding: Embedding.nullable(),
  created_at: z.date(),
});
export type DishCandidate = z.infer<typeof DishCandidate>;
