import { z } from "zod";
import { Aisle, Id, Location, PantrySource, Quantity, SnapStatus, Unit } from "./enums";

export const PantryItem = z.object({
  id: Id,
  household_id: Id,
  ingredient_id: Id.nullable(),
  display_name: z.string().min(1),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  location: Location,
  source: PantrySource,
  confidence: z.number().min(0).max(1).nullable(),
  use_soon: z.boolean(),
  expires_on: z.iso.date().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type PantryItem = z.infer<typeof PantryItem>;

export const SnapProposal = z.object({
  name: z.string().min(1),
  ingredient_id: Id.nullable(),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  count_confidence: z.number().min(0).max(1).nullable(),
  is_packaged: z.boolean(),
  label_text: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  existing_item_id: Id.nullable(),
});
export type SnapProposal = z.infer<typeof SnapProposal>;

export const Snap = z.object({
  id: Id,
  household_id: Id,
  user_id: Id,
  location: Location,
  storage_path: z.string(),
  status: SnapStatus,
  proposals: z.array(SnapProposal).nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  created_at: z.date(),
  deleted_at: z.date().nullable(),
});
export type Snap = z.infer<typeof Snap>;

export const ShoppingItem = z.object({
  id: Id,
  household_id: Id,
  ingredient_id: Id.nullable(),
  display_name: z.string().min(1),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  aisle: Aisle,
  wanted_by: z.array(Id),
  bought: z.boolean(),
  created_at: z.date(),
});
export type ShoppingItem = z.infer<typeof ShoppingItem>;

export const SavedRecipe = z.object({
  household_id: Id,
  recipe_id: Id,
  saved_at: z.date(),
});
export type SavedRecipe = z.infer<typeof SavedRecipe>;

/** How to settle a new item that matches one already in the same place. */
export const MergeChoice = z.enum(["add", "replace", "separate"]);
export type MergeChoice = z.infer<typeof MergeChoice>;

const PantryFields = z.object({
  ingredient_id: Id.nullable(),
  display_name: z.string().trim().min(1).max(120),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  location: Location,
  use_soon: z.boolean(),
  expires_on: z.iso.date().nullable(),
});

/** A new pantry item: typed text such as "2 bell peppers", or its fields. */
export const PantryAddInput = z.union([
  z.object({
    text: z.string().trim().min(1).max(120),
    location: Location,
    merge: MergeChoice.optional(),
  }),
  PantryFields.partial({ use_soon: true, expires_on: true }).extend({
    merge: MergeChoice.optional(),
  }),
]);
export type PantryAddInput = z.infer<typeof PantryAddInput>;

export const PantryPatch = PantryFields.partial().refine(
  (p) => (p.quantity === undefined) === (p.unit === undefined),
  { message: "quantity and unit change together" },
);
export type PantryPatch = z.infer<typeof PantryPatch>;
