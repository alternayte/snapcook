import { expect, test } from "bun:test";
import { type Need, shortfalls } from "./missing";

const need = (over: Partial<Need> & Pick<Need, "ingredient_id">): Need => ({
  name: over.ingredient_id,
  quantity: 100,
  unit: "g",
  staple: false,
  ...over,
});
const facts = new Map([["egg", { grams_per_unit: 50, ml_per_unit: null }]]);

test("only the amount still needed is asked for, in the unit the pantry keeps", () => {
  const out = shortfalls(
    [need({ ingredient_id: "egg", quantity: 300, unit: "g" })],
    [{ ingredient_id: "egg", quantity: 2, unit: "piece" }],
    facts,
  );
  expect(out).toEqual([{ ingredient_id: "egg", display_name: "egg", quantity: 4, unit: "piece" }]);
});

test("enough on hand, or kept as some, asks for nothing", () => {
  expect(
    shortfalls(
      [need({ ingredient_id: "rice", quantity: 200 }), need({ ingredient_id: "oil" })],
      [
        { ingredient_id: "rice", quantity: 500, unit: "g" },
        { ingredient_id: "oil", quantity: null, unit: null },
      ],
      facts,
    ),
  ).toEqual([]);
});

test("an assumed staple is asked for only when the pantry holds some and it falls short", () => {
  const salt = need({ ingredient_id: "salt", quantity: 10, staple: true });
  expect(shortfalls([salt], [], facts)).toEqual([]);
  expect(shortfalls([salt], [{ ingredient_id: "salt", quantity: 4, unit: "g" }], facts)).toEqual([
    { ingredient_id: "salt", display_name: "salt", quantity: 6, unit: "g" },
  ]);
});

test("a missing ingredient comes in full; an amount with no conversion keeps the recipe's unit", () => {
  expect(
    shortfalls(
      [
        need({ ingredient_id: "leek", quantity: 2, unit: "piece" }),
        need({ ingredient_id: "stock", quantity: 500, unit: "ml" }),
      ],
      [{ ingredient_id: "stock", quantity: 1, unit: "piece" }],
      facts,
    ),
  ).toEqual([
    { ingredient_id: "leek", display_name: "leek", quantity: 2, unit: "piece" },
    { ingredient_id: "stock", display_name: "stock", quantity: 500, unit: "ml" },
  ]);
});
