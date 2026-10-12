import { expect, test } from "bun:test";
import { aisleFor } from "./aisle";

test.each([
  [{ name: "bell pepper", category: "vegetable" }, "produce"],
  [{ name: "chicken thigh", category: "poultry" }, "meat_fish"],
  [{ name: "egg", category: "egg" }, "dairy"],
  [{ name: "frozen peas", category: "vegetable" }, "frozen"],
  [{ name: "tinned tuna", category: "fish" }, "pantry"],
  [{ name: "basmati rice", category: "rice" }, "pantry"],
  [undefined, "other"],
] as const)("%o goes to %s", (ingredient, aisle) => {
  expect(aisleFor(ingredient)).toBe(aisle);
});
