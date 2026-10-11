import type { Ingredient } from "./corpus";
import type { Unit } from "./enums";

/** Millilitres in one spoon or cup measure. */
export const ML_PER_MEASURE = { tbsp: 15, tsp: 5, cup: 240 } as const;

type Conversions = Pick<Ingredient, "grams_per_unit" | "ml_per_unit">;

/** A quantity in millilitres, or null when the unit is a weight or a count. */
export function toMillilitres(quantity: number, unit: Unit): number | null {
  if (unit === "ml") return quantity;
  if (unit === "g" || unit === "piece") return null;
  return quantity * ML_PER_MEASURE[unit];
}

/**
 * A quantity in grams, or null when the ingredient has no conversion for the unit.
 * A count needs the ingredient's weight per piece. A volume uses its millilitres per gram, 1 if unset.
 */
export function toGrams(quantity: number, unit: Unit, ingredient: Conversions): number | null {
  if (unit === "g") return quantity;
  if (unit === "piece") {
    return ingredient.grams_per_unit === null ? null : quantity * ingredient.grams_per_unit;
  }
  const ml = toMillilitres(quantity, unit);
  return ml === null ? null : ml / (ingredient.ml_per_unit ?? 1);
}
