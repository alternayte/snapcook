import { expect, test } from "bun:test";
import { convert, roundKitchen, toGrams } from "./units";

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

test.each([
  [387, "g", 375],
  [43, "g", 45],
  [6.4, "g", 6],
  [1234, "ml", 1250],
  [1.4, "tbsp", 1.5],
  [0.3, "tsp", 0.25],
  [1.2, "piece", 1],
  [0.1, "piece", 0.5],
] as const)("%d %s rounds to %d", (quantity, unit, expected) => {
  expect(roundKitchen(quantity, unit)).toBe(expected);
});

test("a quantity converts between count, weight and volume through the ingredient", () => {
  const pepper = { grams_per_unit: 160, ml_per_unit: null };
  expect(convert(2, "piece", "g", pepper)).toBe(320);
  expect(convert(320, "g", "piece", pepper)).toBe(2);
  expect(convert(30, "ml", "tbsp", { grams_per_unit: null, ml_per_unit: null })).toBe(2);
  expect(convert(100, "g", "piece", { grams_per_unit: null, ml_per_unit: null })).toBeNull();
});
