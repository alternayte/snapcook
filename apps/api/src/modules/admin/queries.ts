import { type Db, schema } from "@snapcook/db";
import type { RecipeStatus } from "@snapcook/schema";
import { asc, eq } from "drizzle-orm";

const { ingredients, recipeDeviceVariants, recipeIngredients, recipes, recipeVersions } = schema;

/** Every recipe with its current version, for the list. */
export function listRecipes(db: Db, status?: RecipeStatus) {
  return db
    .select({
      slug: recipes.slug,
      status: recipes.status,
      title: recipeVersions.title,
      cuisine: recipeVersions.cuisine,
      primary_protein: recipeVersions.primary_protein,
      time_total_min: recipeVersions.time_total_min,
      suitability: recipeDeviceVariants.suitability,
    })
    .from(recipes)
    .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
    .leftJoin(recipeDeviceVariants, eq(recipeDeviceVariants.recipe_version_id, recipeVersions.id))
    .where(status ? eq(recipes.status, status) : undefined)
    .orderBy(asc(recipeVersions.cuisine), asc(recipeVersions.title));
}

/** One recipe's current version with its ingredients and device variant, or undefined. */
export async function getRecipe(db: Db, slug: string) {
  const [row] = await db
    .select({ recipe: recipes, version: recipeVersions })
    .from(recipes)
    .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
    .where(eq(recipes.slug, slug));
  if (!row) return undefined;
  const lines = await db
    .select({ line: recipeIngredients, name: ingredients.name, allergens: ingredients.allergens })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredient_id))
    .where(eq(recipeIngredients.recipe_version_id, row.version.id))
    .orderBy(asc(recipeIngredients.position));
  const [variant] = await db
    .select()
    .from(recipeDeviceVariants)
    .where(eq(recipeDeviceVariants.recipe_version_id, row.version.id));
  // Allergens are derived from the ingredients, never stored on the recipe.
  const allergens = [...new Set(lines.flatMap((l) => l.allergens))].sort();
  return { ...row, lines, variant, allergens };
}

export async function setStatus(db: Db, slug: string, status: RecipeStatus) {
  const updated = await db
    .update(recipes)
    .set({ status })
    .where(eq(recipes.slug, slug))
    .returning({ id: recipes.id });
  return updated.length > 0;
}
