import { expect, test } from "bun:test";
import { toGrams } from "./units";

const plain = { grams_per_unit: null, ml_per_unit: null };

test.each([
  [450, "g", plain, 450],
  [2, "piece", { grams_per_unit: 150, ml_per_unit: null }, 300],
  [2, "piece", plain, null],
  [500, "ml", plain, 500],
  [1, "cup", { grams_per_unit: null, ml_per_unit: 1.9 }, 126.32],
  [2, "tbsp", { grams_per_unit: null, ml_per_unit: 1.09 }, 27.52],
  [1, "tsp", plain, 5],
] as const)("%d %s converts to %p g", (quantity, unit, ingredient, grams) => {
  const result = toGrams(quantity, unit, ingredient);
  if (grams === null) expect(result).toBeNull();
  else expect(result).toBeCloseTo(grams, 2);
});
