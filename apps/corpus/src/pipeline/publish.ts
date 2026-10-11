import { type Db, foldName, schema } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import {
  DeviceVariantDraft,
  type DishCandidate,
  RecipeDraft,
  ResearchNotes,
  ReviewVerdict,
} from "@snapcook/schema";
import { eq, sql } from "drizzle-orm";
import { latest } from "./store";
import type { IngredientIndex } from "./validate";
import { BASE_SERVINGS } from "./write";

const {
  dishCandidates,
  ingredientSubstitutes,
  recipeDeviceVariants,
  recipeIngredients,
  recipes,
  recipeVersions,
} = schema;

// At or above this cosine, two ingredient profiles are the same dish under two names.
const DUPLICATE_THRESHOLD = 0.95;

const LETTERS: Record<string, string> = {
  ı: "i",
  ø: "o",
  ß: "ss",
  đ: "d",
  ł: "l",
  æ: "ae",
  œ: "oe",
};

export function slugify(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[ıøßđłæœ]/g, (c) => LETTERS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error(`cannot make a slug from "${name}"`);
  return slug;
}

/** The text a recipe is embedded as: what goes in it, how it is cooked, where it is from, how long. */
export function profileText(
  draft: RecipeDraft,
  dish: Pick<DishCandidate, "technique" | "cuisine">,
) {
  const names = draft.ingredients
    .filter((i) => i.role === "core" || i.role === "supporting")
    .map((i) => i.ingredient);
  return `${names.join(", ")}; ${dish.technique}; ${dish.cuisine.replaceAll("_", " ")}; ${draft.time_total_min} min`;
}

/**
 * Turns a reviewed draft into a recipe with one version, its ingredients and its device variant,
 * embeds it, and makes that version current. Runs only on a draft the reviewer passed.
 */
export async function publish(
  db: Db,
  llm: Llm,
  dish: DishCandidate,
  index: IngredientIndex,
  models: { writer: string; reviewer: string },
) {
  if (dish.recipe_id) return "skipped";
  const draft = await latest(db, dish.id, "write", RecipeDraft);
  if (!draft) return "blocked: no draft";
  const verdict = await latest(db, dish.id, "review", ReviewVerdict);
  if (verdict?.attempt !== draft.attempt || verdict.value.verdict !== "pass")
    return "blocked: not passed";
  const variant = await latest(db, dish.id, "device", DeviceVariantDraft);
  if (variant?.attempt !== draft.attempt) return "blocked: no device variant";
  const notes = await latest(db, dish.id, "research", ResearchNotes);
  if (!notes) return "blocked: no research";

  const idOf = (name: string) => {
    const ingredient = index.get(foldName(name));
    if (!ingredient) throw new Error(`"${name}" is not a canonical ingredient`);
    return ingredient.id;
  };

  const [embedding] = await llm.embed([profileText(draft.value, dish)], {
    endpoint: "corpus.embed",
    household_id: null,
  });
  if (!embedding) throw new Error("the embedding call returned nothing");
  const vector = JSON.stringify(embedding);
  const nearest = await db.execute<{ title: string; similarity: number }>(
    sql`select title, 1 - (embedding <=> ${vector}::vector) as similarity from recipe_versions
        where embedding is not null order by embedding <=> ${vector}::vector limit 1`,
  );
  const twin = nearest.rows[0];
  if (twin && Number(twin.similarity) >= DUPLICATE_THRESHOLD)
    return `blocked: duplicate of ${twin.title}`;

  await db.transaction(async (tx) => {
    const [recipe] = await tx
      .insert(recipes)
      .values({ slug: slugify(dish.name), status: "auto_reviewed" })
      .returning({ id: recipes.id });
    if (!recipe) throw new Error("recipe insert returned nothing");
    const now = new Date().toISOString();
    const [version] = await tx
      .insert(recipeVersions)
      .values({
        recipe_id: recipe.id,
        version: 1,
        title: draft.value.title,
        cuisine: dish.cuisine,
        dish_type: dish.dish_type,
        primary_protein: dish.primary_protein,
        technique: dish.technique,
        time_total_min: draft.value.time_total_min,
        time_active_min: draft.value.time_active_min,
        difficulty: draft.value.difficulty,
        base_servings: BASE_SERVINGS,
        description: draft.value.description,
        steps: draft.value.steps,
        tags: draft.value.tags,
        failure_modes: draft.value.failure_modes,
        provenance: {
          references: notes.value.references.map((r) => ({ ...r, fetched_at: now })),
          writer_model: models.writer,
          reviewer: models.reviewer,
          notes: null,
        },
        embedding,
      })
      .returning({ id: recipeVersions.id });
    if (!version) throw new Error("version insert returned nothing");

    await tx.insert(recipeIngredients).values(
      draft.value.ingredients.map((line, position) => ({
        recipe_version_id: version.id,
        ingredient_id: idOf(line.ingredient),
        quantity: line.quantity,
        unit: line.unit,
        prep: line.prep,
        role: line.role,
        position,
      })),
    );
    const substitutes = draft.value.ingredients.flatMap((line) =>
      line.substitutes
        .map((s) => ({
          ingredient_id: idOf(line.ingredient),
          substitute_id: idOf(s),
          context: "general" as const,
        }))
        .filter((s) => s.ingredient_id !== s.substitute_id),
    );
    if (substitutes.length > 0) {
      await tx.insert(ingredientSubstitutes).values(substitutes).onConflictDoNothing();
    }
    await tx.insert(recipeDeviceVariants).values({
      recipe_version_id: version.id,
      device_profile_id: "mc_smart",
      steps: variant.value.steps,
      suitability: variant.value.suitability,
      notes: variant.value.notes,
    });
    await tx
      .update(recipes)
      .set({ current_version_id: version.id })
      .where(eq(recipes.id, recipe.id));
    await tx
      .update(dishCandidates)
      .set({ recipe_id: recipe.id })
      .where(eq(dishCandidates.id, dish.id));
  });
  return "published";
}
