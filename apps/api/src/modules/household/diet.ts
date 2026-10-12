import type { Allergen, DietFlag, DietStyle, HouseholdProfile } from "@snapcook/schema";

/** What each diet style never eats, as ingredient flags. */
export const FORBIDDEN: Record<DietStyle, DietFlag[]> = {
  none: [],
  pescatarian: ["meat", "pork"],
  vegetarian: ["meat", "pork", "fish", "shellfish"],
  vegan: ["meat", "pork", "fish", "shellfish", "dairy", "egg", "honey"],
  halal: ["pork", "alcohol"],
  kosher: ["pork", "shellfish"],
};

export type DietFacts = { allergens: Allergen[]; contains: DietFlag[] };

/**
 * Says whether the household must not eat an ingredient: an allergen, a cannot-eat entry or a
 * breach of its diet style. An ingredient the corpus does not know is treated as not allowed.
 */
export function createBanCheck(
  profile: Pick<HouseholdProfile, "allergens" | "cannot_eat" | "diet_style">,
  ingredients: Map<string, DietFacts>,
) {
  const allergens = new Set(profile.allergens.map((a) => a.value));
  const cannotEat = new Set(profile.cannot_eat);
  const forbidden = new Set(FORBIDDEN[profile.diet_style]);
  return (id: string) => {
    const ingredient = ingredients.get(id);
    return (
      cannotEat.has(id) ||
      ingredient === undefined ||
      ingredient.allergens.some((a) => allergens.has(a)) ||
      ingredient.contains.some((flag) => forbidden.has(flag))
    );
  };
}
