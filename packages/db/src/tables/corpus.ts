import {
  type Allergen,
  CandidateStatus,
  type DeviceCapabilities,
  DeviceProfileId,
  type DeviceStep,
  type DietFlag,
  EMBEDDING_DIMENSIONS,
  type FailureMode,
  IngredientCategory,
  IngredientRole,
  PipelineStage,
  type Provenance,
  RecipeStatus,
  ReportKind,
  SubstituteContext,
  Suitability,
  Unit,
} from "@snapcook/schema";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { createdAt, enumCheck, enumText, id, quantity, timestamptz } from "../columns";
import { households, recipeImports } from "./household";

const embedding = () => vector({ dimensions: EMBEDDING_DIMENSIONS });

export const ingredients = pgTable(
  "ingredients",
  {
    id: id(),
    name: text().notNull().unique(),
    aliases: text().array().notNull().default([]),
    category: enumText(IngredientCategory).notNull(),
    allergens: text().array().$type<Allergen[]>().notNull().default([]),
    contains: text().array().$type<DietFlag[]>().notNull().default([]),
    default_unit: enumText(Unit).notNull(),
    grams_per_unit: numeric({ precision: 10, scale: 2, mode: "number" }),
    ml_per_unit: numeric({ precision: 10, scale: 2, mode: "number" }),
    is_staple_default: boolean().notNull().default(false),
    embedding: embedding(),
    reviewed: boolean().notNull().default(true),
    added_by_import_id: uuid().references((): AnyPgColumn => recipeImports.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("ingredients_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    enumCheck("ingredients_category_check", t.category, IngredientCategory.options),
    enumCheck("ingredients_default_unit_check", t.default_unit, Unit.options),
  ],
);

export const ingredientSubstitutes = pgTable(
  "ingredient_substitutes",
  {
    ingredient_id: uuid()
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    substitute_id: uuid()
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    context: enumText(SubstituteContext).notNull(),
    note: text(),
  },
  (t) => [
    primaryKey({ columns: [t.ingredient_id, t.substitute_id, t.context] }),
    enumCheck("ingredient_substitutes_context_check", t.context, SubstituteContext.options),
  ],
);

export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    slug: text().notNull().unique(),
    status: enumText(RecipeStatus).notNull().default("draft"),
    current_version_id: uuid().references((): AnyPgColumn => recipeVersions.id),
    household_id: uuid().references(() => households.id, { onDelete: "cascade" }),
    shared_at: timestamptz(),
    removed_at: timestamptz(),
  },
  (t) => [
    enumCheck("recipes_status_check", t.status, RecipeStatus.options),
    index("recipes_household_idx").on(t.household_id),
  ],
);

export const recipeVersions = pgTable(
  "recipe_versions",
  {
    id: id(),
    recipe_id: uuid()
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    title: text().notNull(),
    cuisine: text().notNull(),
    dish_type: text().notNull(),
    primary_protein: text().notNull(),
    technique: text().notNull(),
    time_total_min: integer().notNull(),
    time_active_min: integer().notNull(),
    difficulty: integer().notNull(),
    base_servings: integer().notNull(),
    description: text().notNull(),
    steps: jsonb().$type<DeviceStep[]>().notNull(),
    tags: text().array().notNull().default([]),
    failure_modes: jsonb().$type<FailureMode[]>().notNull().default([]),
    provenance: jsonb().$type<Provenance>().notNull(),
    embedding: embedding(),
    created_at: createdAt(),
  },
  (t) => [
    unique("recipe_versions_recipe_version_unique").on(t.recipe_id, t.version),
    index("recipe_versions_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    recipe_version_id: uuid()
      .notNull()
      .references(() => recipeVersions.id, { onDelete: "cascade" }),
    ingredient_id: uuid()
      .notNull()
      .references(() => ingredients.id),
    quantity: quantity(),
    unit: enumText(Unit),
    prep: text(),
    role: enumText(IngredientRole).notNull(),
    position: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.recipe_version_id, t.position] }),
    index("recipe_ingredients_ingredient_role_idx").on(t.ingredient_id, t.role),
    enumCheck("recipe_ingredients_unit_check", t.unit, Unit.options),
    enumCheck("recipe_ingredients_role_check", t.role, IngredientRole.options),
  ],
);

export const deviceProfiles = pgTable(
  "device_profiles",
  {
    id: enumText(DeviceProfileId).primaryKey(),
    name: text().notNull(),
    capabilities: jsonb().$type<DeviceCapabilities>().notNull(),
  },
  (t) => [enumCheck("device_profiles_id_check", t.id, DeviceProfileId.options)],
);

export const recipeDeviceVariants = pgTable(
  "recipe_device_variants",
  {
    recipe_version_id: uuid()
      .notNull()
      .references(() => recipeVersions.id, { onDelete: "cascade" }),
    device_profile_id: enumText(DeviceProfileId)
      .notNull()
      .references(() => deviceProfiles.id),
    steps: jsonb().$type<DeviceStep[]>().notNull(),
    suitability: enumText(Suitability).notNull(),
    notes: text(),
  },
  (t) => [
    primaryKey({ columns: [t.recipe_version_id, t.device_profile_id] }),
    enumCheck("recipe_device_variants_suitability_check", t.suitability, Suitability.options),
  ],
);

export const recipeImages = pgTable("recipe_images", {
  recipe_version_id: uuid()
    .primaryKey()
    .references(() => recipeVersions.id, { onDelete: "cascade" }),
  file: text(),
  model: text().notNull(),
  prompt: text().notNull(),
  findings: text().array().notNull(),
  created_at: createdAt(),
});

export const recipeReports = pgTable(
  "recipe_reports",
  {
    id: id(),
    recipe_version_id: uuid()
      .notNull()
      .references(() => recipeVersions.id, { onDelete: "cascade" }),
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    kind: enumText(ReportKind).notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    resolved: boolean().notNull().default(false),
    created_at: createdAt(),
  },
  (t) => [
    index("recipe_reports_version_resolved_idx").on(t.recipe_version_id, t.resolved),
    enumCheck("recipe_reports_kind_check", t.kind, ReportKind.options),
  ],
);

export const dishCandidates = pgTable(
  "dish_candidates",
  {
    id: id(),
    name: text().notNull().unique(),
    aliases: text().array().notNull().default([]),
    cuisine: text().notNull(),
    dish_type: text().notNull(),
    primary_protein: text().notNull(),
    technique: text().notNull(),
    time_band: text().notNull(),
    status: enumText(CandidateStatus).notNull().default("proposed"),
    batch: integer(),
    recipe_id: uuid().references(() => recipes.id, { onDelete: "set null" }),
    similar_to: uuid().references((): AnyPgColumn => dishCandidates.id, { onDelete: "set null" }),
    embedding: embedding(),
    created_at: createdAt(),
  },
  (t) => [
    index("dish_candidates_cuisine_idx").on(t.cuisine),
    enumCheck("dish_candidates_status_check", t.status, CandidateStatus.options),
  ],
);

export const dishStageOutputs = pgTable(
  "dish_stage_outputs",
  {
    id: id(),
    candidate_id: uuid()
      .notNull()
      .references(() => dishCandidates.id, { onDelete: "cascade" }),
    stage: enumText(PipelineStage).notNull(),
    attempt: integer().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    created_at: createdAt(),
  },
  (t) => [
    unique("dish_stage_outputs_candidate_stage_attempt_unique").on(
      t.candidate_id,
      t.stage,
      t.attempt,
    ),
    enumCheck("dish_stage_outputs_stage_check", t.stage, PipelineStage.options),
  ],
);
