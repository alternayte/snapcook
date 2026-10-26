import { schema } from "@snapcook/db";
import type { Recipe, RecipeSource } from "@snapcook/schema";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

const { recipes } = schema;

/** The recipe statuses a household may be shown. */
export const SERVABLE = ["auto_reviewed", "human_reviewed", "test_cooked"] as const;

type Owned = Pick<Recipe, "household_id" | "shared_at" | "removed_at">;

/** Whether a household may see a recipe: an official one, its own, or one shared and not removed. */
export const canSee = (recipe: Owned, householdId: string) =>
  recipe.household_id === null ||
  recipe.household_id === householdId ||
  (recipe.shared_at !== null && recipe.removed_at === null);

/** `canSee` as a query condition, together with the servable statuses. */
export const visibleTo = (householdId: string) =>
  and(
    inArray(recipes.status, [...SERVABLE]),
    or(
      isNull(recipes.household_id),
      eq(recipes.household_id, householdId),
      and(isNotNull(recipes.shared_at), isNull(recipes.removed_at)),
    ),
  );

/** Who wrote the recipe, as this household sees it. */
export const sourceOf = (recipe: Owned, householdId: string): RecipeSource =>
  recipe.household_id === null
    ? "official"
    : recipe.household_id === householdId
      ? "household"
      : "community";

/** For the household's own recipe, where it stands with the community. Null for any other. */
export const sharingOf = (recipe: Owned, householdId: string) =>
  recipe.household_id !== householdId
    ? null
    : recipe.removed_at
      ? ("removed" as const)
      : recipe.shared_at
        ? ("shared" as const)
        : ("private" as const);
