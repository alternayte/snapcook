import { expect, test } from "bun:test";
import { normaliseQuantity } from "./detect";

test.each([
  [
    "a pack size on the label wins over the estimate",
    { quantity: 300, unit: "g", label_text: "Chicken thighs 450 g" },
    { quantity: 450, unit: "g" },
  ],
  [
    "kilograms and litres become grams and millilitres",
    { quantity: null, unit: null, label_text: "1,5 kg" },
    { quantity: 1500, unit: "g" },
  ],
  [
    "two visible packs double the pack size",
    { quantity: 2, unit: "piece", label_text: "500ml" },
    { quantity: 1000, unit: "ml" },
  ],
  [
    "an amount with no unit is a count",
    { quantity: 2, unit: null, label_text: null },
    { quantity: 2, unit: "piece" },
  ],
  [
    "a label with no amount leaves the estimate",
    { quantity: 3, unit: "piece", label_text: "Organic" },
    { quantity: 3, unit: "piece" },
  ],
  [
    "no amount stays empty",
    { quantity: null, unit: null, label_text: null },
    { quantity: null, unit: null },
  ],
] as const)("%s", (_name, item, expected) => {
  expect(normaliseQuantity(item)).toEqual(expected);
});
