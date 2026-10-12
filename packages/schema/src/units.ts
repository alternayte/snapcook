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

/**
 * A quantity expressed in another unit of the same ingredient, or null when the ingredient has
 * no conversion between the two.
 */
export function convert(quantity: number, from: Unit, to: Unit, ingredient: Conversions) {
  if (from === to) return quantity;
  const grams = toGrams(quantity, from, ingredient);
  if (grams === null) return null;
  if (to === "g") return grams;
  if (to === "piece") {
    return ingredient.grams_per_unit === null ? null : grams / ingredient.grams_per_unit;
  }
  const ml = grams * (ingredient.ml_per_unit ?? 1);
  return to === "ml" ? ml : ml / ML_PER_MEASURE[to];
}

// The step a quantity is rounded to, by size: [upper bound, step].
const WEIGHT_STEPS: [number, number][] = [
  [10, 1],
  [50, 5],
  [250, 10],
  [1000, 25],
  [Number.POSITIVE_INFINITY, 50],
];

/** Rounds a quantity to what a cook measures: 400 g, not 387 g; 1.5 tbsp, not 1.4. */
export function roundKitchen(quantity: number, unit: Unit) {
  const nearest = (step: number) => Math.max(step, Math.round(quantity / step) * step);
  if (unit === "g" || unit === "ml") {
    const [, step] = WEIGHT_STEPS.find(([limit]) => quantity < limit) ?? [0, 50];
    return nearest(step);
  }
  if (unit === "piece") return nearest(0.5);
  return Number(nearest(quantity < 1 ? 0.25 : 0.5).toFixed(2));
}
