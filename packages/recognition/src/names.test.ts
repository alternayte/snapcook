import { expect, test } from "bun:test";
import { nameForms } from "./names";

test("a plural name is also tried in its singular forms", () => {
  expect(nameForms("Bell  Peppers")).toContain("bell pepper");
  expect(nameForms("tomatoes")).toContain("tomato");
  expect(nameForms("berries")).toContain("berry");
});
