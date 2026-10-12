import { expect, test } from "bun:test";
import { parseEntry } from "./parse";

test.each([
  ["2 bell peppers", { name: "bell peppers", quantity: 2, unit: "piece" }],
  ["chicken 450g", { name: "chicken", quantity: 450, unit: "g" }],
  ["chicken thighs 450 g", { name: "chicken thighs", quantity: 450, unit: "g" }],
  ["1.5 kg potatoes", { name: "potatoes", quantity: 1500, unit: "g" }],
  ["1,5kg potatoes", { name: "potatoes", quantity: 1500, unit: "g" }],
  ["500 ml of milk", { name: "milk", quantity: 500, unit: "ml" }],
  ["1l milk", { name: "milk", quantity: 1000, unit: "ml" }],
  ["½ lemon", { name: "lemon", quantity: 0.5, unit: "piece" }],
  ["eggs x 6", { name: "eggs", quantity: 6, unit: "piece" }],
  ["eggs 6", { name: "eggs", quantity: 6, unit: "piece" }],
  ["milk", { name: "milk", quantity: null, unit: null }],
  ["  00 flour ", { name: "00 flour", quantity: null, unit: null }],
  ["7 spice mix", { name: "spice mix", quantity: 7, unit: "piece" }],
  ["lemon juice", { name: "lemon juice", quantity: null, unit: null }],
  ["2 large onions", { name: "large onions", quantity: 2, unit: "piece" }],
])("%s", (text, expected) => {
  expect(parseEntry(text)).toEqual(expected as ReturnType<typeof parseEntry>);
});
