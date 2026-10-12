import { z } from "zod";

export const Allergen = z.enum([
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soy",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
]);
export type Allergen = z.infer<typeof Allergen>;

/**
 * What an ingredient is or is made from, where a diet cares. "meat" covers anything from a
 * slaughtered land animal, such as stock, lard and gelatine.
 */
export const DietFlag = z.enum([
  "meat",
  "pork",
  "fish",
  "shellfish",
  "dairy",
  "egg",
  "honey",
  "alcohol",
]);
export type DietFlag = z.infer<typeof DietFlag>;

export const Unit = z.enum(["g", "ml", "piece", "tbsp", "tsp", "cup"]);
export type Unit = z.infer<typeof Unit>;

export const Location = z.enum(["fridge", "freezer", "pantry", "counter"]);
export type Location = z.infer<typeof Location>;

export const Plan = z.enum(["free", "pro", "owner"]);
export type Plan = z.infer<typeof Plan>;

export const MemberRole = z.enum(["owner", "member"]);
export type MemberRole = z.infer<typeof MemberRole>;

export const DietStyle = z.enum(["none", "vegetarian", "vegan", "pescatarian", "halal", "kosher"]);
export type DietStyle = z.infer<typeof DietStyle>;

export const Effort = z.enum(["lazy", "normal"]);
export type Effort = z.infer<typeof Effort>;

export const PantrySource = z.enum(["photo", "manual", "shopping_list", "draw_down"]);
export type PantrySource = z.infer<typeof PantrySource>;

export const SnapStatus = z.enum(["queued", "done", "failed"]);
export type SnapStatus = z.infer<typeof SnapStatus>;

export const Meter = z.enum(["snaps", "suggestions", "adaptations", "rescues"]);
export type Meter = z.infer<typeof Meter>;

export const Aisle = z.enum(["produce", "meat_fish", "dairy", "pantry", "frozen", "other"]);
export type Aisle = z.infer<typeof Aisle>;

export const IngredientCategory = z.enum([
  "vegetable",
  "fruit",
  "herb",
  "meat",
  "poultry",
  "fish",
  "seafood",
  "dairy",
  "egg",
  "grain",
  "pasta",
  "rice",
  "pulse",
  "nut_seed",
  "spice",
  "oil_fat",
  "condiment",
  "sauce",
  "baking",
  "sweetener",
  "stock",
  "alcohol",
  "beverage",
  "other",
]);
export type IngredientCategory = z.infer<typeof IngredientCategory>;

export const SubstituteContext = z.enum(["general", "dairy_free", "vegan"]);
export type SubstituteContext = z.infer<typeof SubstituteContext>;

export const RecipeStatus = z.enum([
  "draft",
  "auto_reviewed",
  "human_reviewed",
  "test_cooked",
  "hidden",
]);
export type RecipeStatus = z.infer<typeof RecipeStatus>;

export const IngredientRole = z.enum(["core", "supporting", "staple", "optional"]);
export type IngredientRole = z.infer<typeof IngredientRole>;

export const Suitability = z.enum(["native", "partial", "unsuitable"]);
export type Suitability = z.infer<typeof Suitability>;

export const ReportKind = z.enum(["rating", "off", "rescue"]);
export type ReportKind = z.infer<typeof ReportKind>;

export const SubscriptionStatus = z.enum([
  "active",
  "in_trial",
  "billing_issue",
  "cancelled",
  "expired",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const CandidateStatus = z.enum(["proposed", "kept", "dropped"]);
export type CandidateStatus = z.infer<typeof CandidateStatus>;

export const DeviceProfileId = z.enum(["mc_smart"]);
export type DeviceProfileId = z.infer<typeof DeviceProfileId>;

export const EMBEDDING_DIMENSIONS = 1024;
export const Embedding = z.array(z.number()).length(EMBEDDING_DIMENSIONS);
export type Embedding = z.infer<typeof Embedding>;

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** Quantities are stored with two decimals. */
export const Quantity = z.number().nonnegative().multipleOf(0.01);
