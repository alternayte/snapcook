import { z } from "zod";
import { Id, ImportStatus, IngredientRole, Quantity, RecipeSource, Unit } from "./enums";

/** The most images one import reads. */
export const MAX_IMPORT_IMAGES = 6;

/** One ingredient line of a recipe being imported or edited. */
export const ImportLine = z.object({
  /** The ingredient in its plain, generic form, as the household checked it. */
  name: z.string().trim().min(1).max(80),
  /** The ingredient it matches. Null means saving adds it to the ingredient list. */
  ingredient_id: Id.nullable(),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  prep: z.string().trim().max(120).nullable(),
  role: IngredientRole,
});
export type ImportLine = z.infer<typeof ImportLine>;

export const ImportStep = z.object({
  text: z.string().trim().min(1).max(1000),
  kind: z.enum(["prep", "pan", "oven", "rest"]),
  lane: z.enum(["main", "side"]),
  minutes: z.number().positive().optional(),
});
export type ImportStep = z.infer<typeof ImportStep>;

/** A recipe as the check screen shows it: what the images say, or the recipe being edited. */
export const ImportDraft = z.object({
  title: z.string().trim().min(1).max(120),
  servings: z.number().int().positive().max(24),
  time_total_min: z.number().int().positive(),
  time_active_min: z.number().int().positive(),
  cuisine: z.string().min(1),
  dish_type: z.string().min(1),
  primary_protein: z.string().min(1),
  technique: z.string().min(1),
  ingredients: z.array(ImportLine).min(1).max(60),
  steps: z.array(ImportStep).min(1).max(40),
});
export type ImportDraft = z.infer<typeof ImportDraft>;

/** Why an import ended without a recipe. */
export const ImportError = z.enum(["not_a_recipe", "read_failed", "checks_failed", "save_failed"]);
export type ImportError = z.infer<typeof ImportError>;

export const RecipeImport = z.object({
  id: Id,
  household_id: Id,
  user_id: Id,
  /** The recipe being edited, or the recipe this import made. Null before an import is saved. */
  recipe_id: Id.nullable(),
  /** True when this changes an existing recipe instead of adding one. */
  is_edit: z.boolean(),
  status: ImportStatus,
  /** Image files under the photo directory. They are deleted once the import has ended. */
  photos: z.array(z.string().min(1)),
  draft: ImportDraft.nullable(),
  error: ImportError.nullable(),
  /** What the recipe checks found, when they failed. */
  problems: z.array(z.string()),
  cost_usd: z.number().nonnegative(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type RecipeImport = z.infer<typeof RecipeImport>;

/** An import as the app sees it. */
export const ImportView = z.object({
  id: Id,
  status: ImportStatus,
  draft: ImportDraft.nullable(),
  error: ImportError.nullable(),
  problems: z.array(z.string()),
  recipe_id: Id.nullable(),
  /** True when this changes an existing recipe instead of adding one. */
  editing: z.boolean(),
  /** The values the classification fields may take, for the check screen. */
  choices: z.object({
    cuisine: z.array(z.string()),
    dish_type: z.array(z.string()),
    primary_protein: z.array(z.string()),
    technique: z.array(z.string()),
  }),
});
export type ImportView = z.infer<typeof ImportView>;

export const BrowseFilter = z.enum(["official", "community", "household", "saved"]);
export type BrowseFilter = z.infer<typeof BrowseFilter>;

export const BrowseQuery = z.object({
  source: BrowseFilter.optional(),
  q: z.string().trim().max(80).optional(),
  cuisine: z.string().max(40).optional(),
  max_time: z.coerce.number().int().positive().optional(),
  effort: z.enum(["lazy", "normal"]).optional(),
  mc_only: z.stringbool().optional(),
  /** Hides recipes the household's allergies and diet rule out. On unless set to false. */
  fits: z.stringbool().optional(),
  sort: z.enum(["match", "title"]).optional(),
});
export type BrowseQuery = z.infer<typeof BrowseQuery>;

export const BrowseCard = z.object({
  recipe_id: Id,
  recipe_version_id: Id,
  title: z.string(),
  cuisine: z.string(),
  time_total_min: z.number().int(),
  time_active_min: z.number().int(),
  difficulty: z.number().int(),
  image: z.string().nullable(),
  has_device_variant: z.boolean(),
  source: RecipeSource,
  /** Ingredients on hand, directly or as a stand-in. */
  have: z.number().int(),
  /** Ingredients the household lacks, core ones first. */
  missing: z.array(Id),
  /** False when the household's allergies or diet rule the dish out. */
  fits: z.boolean(),
});
export type BrowseCard = z.infer<typeof BrowseCard>;

export const BrowseResponse = z.object({
  cards: z.array(BrowseCard),
  names: z.record(Id, z.string()),
  /** Every cuisine among the recipes this household can see, for the filter. */
  cuisines: z.array(z.string()),
});
export type BrowseResponse = z.infer<typeof BrowseResponse>;

/** Adds to the shopping list what a recipe needs and the pantry lacks. */
export const AddMissingInput = z.object({
  recipe_id: Id,
  /** The fitted recipe, when there is one: its amounts and swaps are used. */
  adaptation_id: Id.optional(),
});
export type AddMissingInput = z.infer<typeof AddMissingInput>;
