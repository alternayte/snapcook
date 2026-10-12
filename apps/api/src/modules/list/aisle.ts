import type { Aisle, IngredientCategory } from "@snapcook/schema";

const BY_CATEGORY: Partial<Record<IngredientCategory, Aisle>> = {
  vegetable: "produce",
  fruit: "produce",
  herb: "produce",
  meat: "meat_fish",
  poultry: "meat_fish",
  fish: "meat_fish",
  seafood: "meat_fish",
  dairy: "dairy",
  egg: "dairy",
};

/**
 * Where in the shop a line is found. Anything frozen goes to the freezers whatever it is; an
 * ingredient the list does not know goes under "other".
 */
export function aisleFor(
  ingredient: { name: string; category: IngredientCategory } | undefined,
): Aisle {
  if (!ingredient) return "other";
  if (/\bfrozen\b/.test(ingredient.name)) return "frozen";
  if (/^(tinned|canned|dried|smoked)\b/.test(ingredient.name)) return "pantry";
  return BY_CATEGORY[ingredient.category] ?? "pantry";
}
