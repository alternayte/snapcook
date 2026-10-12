import { expect, test } from "bun:test";
import type { Deduction, PantryItem, Unit } from "@snapcook/schema";
import { drawDown } from "./drawdown";

const item = (
  id: string,
  ingredient_id: string | null,
  quantity: number | null,
  unit: Unit | null,
): PantryItem => ({
  id,
  household_id: "h",
  ingredient_id,
  display_name: id,
  quantity,
  unit,
  location: "fridge",
  source: "manual",
  confidence: null,
  use_soon: false,
  expires_on: null,
  created_at: new Date(0),
  updated_at: new Date(0),
});
const take = (pantry_item_id: string, quantity: number, unit: Unit): Deduction => ({
  pantry_item_id,
  quantity,
  unit,
});

const conversions = new Map([
  ["pepper", { grams_per_unit: 160, ml_per_unit: null }],
  ["milk", { grams_per_unit: null, ml_per_unit: 0.97 }],
  ["water", { grams_per_unit: null, ml_per_unit: null }],
  ["rice", { grams_per_unit: null, ml_per_unit: null }],
  ["salt", { grams_per_unit: null, ml_per_unit: null }],
]);
const run = (items: PantryItem[], deductions: Deduction[], staples: string[] = []) =>
  drawDown(deductions, new Map(items.map((i) => [i.id, i])), conversions, new Set(staples));

test.each([
  ["the same unit subtracts directly", item("a", "rice", 500, "g"), take("a", 200, "g"), 300],
  [
    "grams come off a count through the weight of one piece",
    item("a", "pepper", 3, "piece"),
    take("a", 320, "g"),
    1,
  ],
  ["a count comes off grams", item("a", "pepper", 500, "g"), take("a", 2, "piece"), 180],
  [
    "grams come off millilitres through the density",
    item("a", "milk", 1000, "ml"),
    take("a", 100, "g"),
    903,
  ],
  ["a spoon measure is millilitres", item("a", "water", 100, "ml"), take("a", 2, "tbsp"), 70],
  [
    "a cup comes off grams of a water-like ingredient",
    item("a", "water", 500, "g"),
    take("a", 1, "cup"),
    260,
  ],
] as const)("%s", (_name, held, deduction, expected) => {
  const result = run([held], [deduction]);
  expect(result.update).toEqual([{ id: "a", quantity: expected }]);
  expect(result.remove).toEqual([]);
});

test("an item that reaches zero is removed, and never goes below zero", () => {
  const result = run([item("a", "rice", 150, "g")], [take("a", 400, "g")]);
  expect(result.update).toEqual([]);
  expect(result.remove.map((i) => i.id)).toEqual(["a"]);
  // What was really there is what was taken.
  expect(result.applied).toEqual([take("a", 150, "g")]);
});

test("two deductions on one item add up", () => {
  const result = run([item("a", "rice", 500, "g")], [take("a", 100, "g"), take("a", 150, "g")]);
  expect(result.update).toEqual([{ id: "a", quantity: 250 }]);
  expect(result.applied).toEqual([take("a", 250, "g")]);
});

test("an item with no amount, an assumed staple and a missing item are left alone", () => {
  const result = run(
    [item("some", "rice", null, null), item("salt", "salt", 500, "g")],
    [take("some", 100, "g"), take("salt", 5, "g"), take("gone", 1, "piece")],
    ["salt"],
  );
  expect(result).toEqual({ update: [], remove: [], applied: [], needsInput: [] });
});

test("a deduction with no conversion stops everything and is handed back", () => {
  const result = run(
    [item("a", "rice", 500, "g"), item("b", "rice", 3, "piece"), item("c", null, 2, "piece")],
    [take("a", 100, "g"), take("b", 200, "g"), take("c", 50, "g")],
  );
  expect(result.update).toEqual([]);
  expect(result.applied).toEqual([]);
  expect(result.needsInput).toEqual([take("b", 200, "g"), take("c", 50, "g")]);
});
