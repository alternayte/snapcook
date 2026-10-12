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

/** One reviewed proposal the household accepted, as it should land in the pantry. */
export const AcceptedProposal = z.object({
  ingredient_id: Id.nullable(),
  display_name: z.string().trim().min(1).max(120),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  location: Location,
  confidence: z.number().min(0).max(1).nullable(),
  /** Set when the item matches one already in the pantry: which one, and what to do. */
  merge: z.object({ existing_item_id: Id, choice: MergeChoice }).optional(),
});
export type AcceptedProposal = z.infer<typeof AcceptedProposal>;

export const SnapCommitInput = z.object({ accepted: z.array(AcceptedProposal).min(1).max(200) });
export type SnapCommitInput = z.infer<typeof SnapCommitInput>;

/** The largest photo the API accepts. The app sends far smaller ones. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** One line to add to the shopping list: typed text, or an ingredient a recipe needs. */
export const ListAddItem = z.union([
  z.object({ text: z.string().trim().min(1).max(120) }),
  z.object({
    ingredient_id: Id.nullable(),
    display_name: z.string().trim().min(1).max(120),
    quantity: Quantity.nullable(),
    unit: Unit.nullable(),
    /** The recipe that wants it, shown on the line. */
    recipe_id: Id.optional(),
  }),
]);
export type ListAddItem = z.infer<typeof ListAddItem>;

export const ListAddInput = z.object({ items: z.array(ListAddItem).min(1).max(50) });

export const ListPatch = z
  .object({
    bought: z.boolean(),
    display_name: z.string().trim().min(1).max(120),
    quantity: Quantity.nullable(),
    unit: Unit.nullable(),
  })
  .partial()
  .refine((p) => (p.quantity === undefined) === (p.unit === undefined), {
    message: "quantity and unit change together",
  });
export type ListPatch = z.infer<typeof ListPatch>;

export const PutAwayInput = z.object({ location: Location });

/** A saved recipe as the saved list shows it. */
export const SavedCard = z.object({
  recipe_id: Id,
  title: z.string(),
  cuisine: z.string(),
  time_total_min: z.number().int(),
  image: z.string().nullable(),
  saved_at: z.date(),
});
export type SavedCard = z.infer<typeof SavedCard>;
