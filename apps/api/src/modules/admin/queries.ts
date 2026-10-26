import { type Db, schema } from "@snapcook/db";
import type { Allergen, DietFlag, IngredientCategory, RecipeStatus, Unit } from "@snapcook/schema";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

const {
  householdProfiles,
  households,
  ingredients,
  pantryItems,
  recipeImports,
  shoppingItems,
  recipeDeviceVariants,
  recipeImages,
  recipeIngredients,
  recipes,
  recipeVersions,
} = schema;

/** Every official recipe with its current version, for the list. */
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
    .where(and(isNull(recipes.household_id), status ? eq(recipes.status, status) : undefined))
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
  const [image] = await db
    .select()
    .from(recipeImages)
    .where(eq(recipeImages.recipe_version_id, row.version.id));
  return { ...row, lines, variant, allergens, image };
}

export async function setStatus(db: Db, slug: string, status: RecipeStatus) {
  const updated = await db
    .update(recipes)
    .set({ status })
    .where(eq(recipes.slug, slug))
    .returning({ id: recipes.id });
  return updated.length > 0;
}

/** Every shared household recipe, removed ones included, newest share first. */
export function listCommunity(db: Db) {
  return db
    .select({
      id: recipes.id,
      slug: recipes.slug,
      title: recipeVersions.title,
      household: households.name,
      shared_at: recipes.shared_at,
      removed_at: recipes.removed_at,
    })
    .from(recipes)
    .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
    .innerJoin(households, eq(households.id, recipes.household_id))
    .where(isNotNull(recipes.shared_at))
    .orderBy(desc(recipes.shared_at));
}

/** Takes a recipe off the community list, or puts it back. The household keeps it either way. */
export async function setRemoved(db: Db, id: string, removed: boolean) {
  const updated = await db
    .update(recipes)
    .set({ removed_at: removed ? new Date() : null })
    .where(and(eq(recipes.id, id), isNotNull(recipes.household_id)))
    .returning({ id: recipes.id });
  return updated.length > 0;
}

/** Ingredients that imports added and no person has checked yet, with the recipe that added each. */
export function listUnreviewed(db: Db) {
  return db
    .select({ ingredient: ingredients, recipe_id: recipeImports.recipe_id })
    .from(ingredients)
    .leftJoin(recipeImports, eq(recipeImports.id, ingredients.added_by_import_id))
    .where(eq(ingredients.reviewed, false))
    .orderBy(asc(ingredients.name));
}

export type IngredientFix = {
  category: IngredientCategory;
  allergens: Allergen[];
  contains: DietFlag[];
  default_unit: Unit;
  grams_per_unit: number | null;
};

/** Sets an ingredient's facts as a person checked them, and marks it reviewed. */
export async function approveIngredient(db: Db, id: string, fix: IngredientFix) {
  const updated = await db
    .update(ingredients)
    .set({ ...fix, reviewed: true })
    .where(eq(ingredients.id, id))
    .returning({ id: ingredients.id });
  return updated.length > 0;
}

/**
 * Merges one ingredient into another: every recipe line, pantry line, list line, stand-in and
 * profile entry that names the first names the second, the first's name becomes an alias of
 * the second, and the first is deleted. One transaction.
 */
export async function mergeIngredient(db: Db, fromId: string, intoId: string) {
  if (fromId === intoId) return false;
  return db.transaction(async (tx) => {
    const [from] = await tx.select().from(ingredients).where(eq(ingredients.id, fromId));
    const [into] = await tx.select().from(ingredients).where(eq(ingredients.id, intoId));
    if (!from || !into) return false;
    await tx
      .update(recipeIngredients)
      .set({ ingredient_id: intoId })
      .where(eq(recipeIngredients.ingredient_id, fromId));
    await tx
      .update(pantryItems)
      .set({ ingredient_id: intoId })
      .where(eq(pantryItems.ingredient_id, fromId));
    await tx
      .update(shoppingItems)
      .set({ ingredient_id: intoId })
      .where(eq(shoppingItems.ingredient_id, fromId));
    // Stand-ins move over unless the other ingredient already has them, or they would name itself.
    await tx.execute(sql`
      insert into ingredient_substitutes (ingredient_id, substitute_id, context, note)
      select case when ingredient_id = ${fromId} then ${intoId}::uuid else ingredient_id end,
             case when substitute_id = ${fromId} then ${intoId}::uuid else substitute_id end,
             context, note
      from ingredient_substitutes
      where (ingredient_id = ${fromId} or substitute_id = ${fromId})
        and not (ingredient_id = ${fromId} and substitute_id = ${intoId})
        and not (ingredient_id = ${intoId} and substitute_id = ${fromId})
      on conflict do nothing`);
    for (const column of ["staples", "dislikes", "cannot_eat"] as const) {
      const field = householdProfiles[column];
      await tx
        .update(householdProfiles)
        .set({
          [column]: sql`array(select distinct unnest(array_replace(${field}, ${fromId}::uuid, ${intoId}::uuid)))`,
        })
        .where(sql`${fromId}::uuid = any(${field})`);
    }
    const aliases = [...new Set([...into.aliases, from.name, ...from.aliases])].filter(
      (name) => name !== into.name,
    );
    await tx.update(ingredients).set({ aliases }).where(eq(ingredients.id, intoId));
    // The stand-in rows of the first go with it.
    await tx.delete(ingredients).where(eq(ingredients.id, fromId));
    return true;
  });
}

/** Every ingredient name, for choosing what to merge into. */
export function ingredientNames(db: Db) {
  return db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .orderBy(asc(ingredients.name));
}
