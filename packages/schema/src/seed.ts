import { z } from "zod";
import { DeviceProfile, Ingredient } from "./corpus";

/** One row of the canonical ingredient list, before it has an id or an embedding. */
export const IngredientSeed = Ingredient.omit({
  id: true,
  embedding: true,
  reviewed: true,
  added_by_import_id: true,
});
export type IngredientSeed = z.infer<typeof IngredientSeed>;

export const DeviceProfileSeed = z.array(DeviceProfile);
