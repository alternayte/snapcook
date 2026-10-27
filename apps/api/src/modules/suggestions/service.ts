import { type Db, schema } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import type {
  Household,
  HouseholdProfile,
  NearMiss,
  PantrySnapshotLine,
  Recipe,
  SuggestInput,
  SuggestionCard,
  SuggestRequest,
  SuggestResponse,
} from "@snapcook/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { canSee, SERVABLE, sourceOf } from "../recipes/visibility";
import { type Corpus, type CorpusRecipe, pickVaried, rank, type Scored } from "./rank";

const {
  ingredientSubstitutes,
  ingredients,
  pantryItems,
  recipeDeviceVariants,
  recipeImages,
  recipeIngredients,
  recipes,
  recipeVersions,
  suggestionRuns,
} = schema;

const PAGE_SIZE = 6;
// Below this many results, the near misses are shown as well.
const FEW_RESULTS = 3;
const NEAR_SHOWN = 2;
// The corpus changes only when a batch is published, so one read serves many requests.
const CORPUS_TTL_MS = 60 * 1000;

type Display = Pick<
  SuggestionCard,
  "recipe_id" | "title" | "cuisine" | "time_total_min" | "time_active_min" | "difficulty" | "image"
>;
type Owner = Pick<Recipe, "household_id" | "shared_at" | "removed_at" | "orphaned_at">;
export type Loaded = Corpus & {
  display: Map<string, Display>;
  /** Who owns each recipe version, to decide who may see it. */
  owners: Map<string, Owner>;
};

/** The part of the corpus one household may see. `officialOnly` leaves community recipes out. */
export function visibleCorpus(loaded: Loaded, householdId: string, officialOnly = false): Corpus {
  return {
    ...loaded,
    recipes: loaded.recipes.filter((recipe) => {
      const owner = loaded.owners.get(recipe.recipe_version_id);
      if (!owner || !canSee(owner, householdId)) return false;
      return !officialOnly || sourceOf(owner, householdId) !== "community";
    }),
  };
}

/** Reads every servable recipe once and keeps it for a short time. */
export function createCorpusReader(db: Db) {
  let cached: { at: number; value: Promise<Loaded> } | undefined;

  async function load(): Promise<Loaded> {
    const versions = await db
      .select({
        version: recipeVersions,
        owner: {
          household_id: recipes.household_id,
          shared_at: recipes.shared_at,
          removed_at: recipes.removed_at,
          orphaned_at: recipes.orphaned_at,
        },
        suitability: recipeDeviceVariants.suitability,
        image: recipeImages.file,
      })
      .from(recipes)
      .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
      .leftJoin(recipeDeviceVariants, eq(recipeDeviceVariants.recipe_version_id, recipeVersions.id))
      .leftJoin(recipeImages, eq(recipeImages.recipe_version_id, recipeVersions.id))
      .where(inArray(recipes.status, [...SERVABLE]));
    const ids = versions.map((v) => v.version.id);
    const lines =
      ids.length === 0
        ? []
        : await db
            .select()
            .from(recipeIngredients)
            .where(inArray(recipeIngredients.recipe_version_id, ids));
    const byVersion = new Map<string, CorpusRecipe["lines"]>();
    for (const { recipe_version_id, ingredient_id, quantity, unit, role } of lines) {
      const list = byVersion.get(recipe_version_id) ?? [];
      list.push({ ingredient_id, quantity, unit, role });
      byVersion.set(recipe_version_id, list);
    }
    const all = await db
      .select({
        id: ingredients.id,
        name: ingredients.name,
        allergens: ingredients.allergens,
        contains: ingredients.contains,
        grams_per_unit: ingredients.grams_per_unit,
        ml_per_unit: ingredients.ml_per_unit,
      })
      .from(ingredients);
    const swaps = await db
      .select()
      .from(ingredientSubstitutes)
      .where(eq(ingredientSubstitutes.context, "general"));
    const substitutes = new Map<string, string[]>();
    for (const swap of swaps) {
      substitutes.set(swap.ingredient_id, [
        ...(substitutes.get(swap.ingredient_id) ?? []),
        swap.substitute_id,
      ]);
    }
    return {
      recipes: versions.map(({ version, suitability }) => ({
        recipe_version_id: version.id,
        primary_protein: version.primary_protein,
        technique: version.technique,
        cuisine: version.cuisine,
        time_total_min: version.time_total_min,
        time_active_min: version.time_active_min,
        difficulty: version.difficulty,
        base_servings: version.base_servings,
        has_device_variant: suitability === "native" || suitability === "partial",
        embedding: version.embedding,
        lines: byVersion.get(version.id) ?? [],
      })),
      ingredients: new Map(all.map((i) => [i.id, i])),
      substitutes,
      owners: new Map(versions.map(({ version, owner }) => [version.id, owner])),
      display: new Map(
        versions.map(({ version, image }) => [
          version.id,
          {
            recipe_id: version.recipe_id,
            title: version.title,
            cuisine: version.cuisine,
            time_total_min: version.time_total_min,
            time_active_min: version.time_active_min,
            difficulty: version.difficulty,
            image,
          },
        ]),
      ),
    };
  }

  return {
    read: () => {
      if (!cached || Date.now() - cached.at > CORPUS_TTL_MS) {
        cached = { at: Date.now(), value: load() };
      }
      return cached.value;
    },
    /** Drops the kept copy, after a change a household should see at once. */
    invalidate: () => {
      cached = undefined;
    },
  };
}

export type CorpusReader = ReturnType<typeof createCorpusReader>;

/** The mapped pantry, one line per ingredient. Amounts in one unit add up; mixed units mean "some". */
export async function snapshot(db: Db, householdId: string): Promise<PantrySnapshotLine[]> {
  const rows = await db
    .select()
    .from(pantryItems)
    .where(and(eq(pantryItems.household_id, householdId), isNotNull(pantryItems.ingredient_id)));
  const lines = new Map<string, PantrySnapshotLine>();
  for (const row of rows) {
    if (!row.ingredient_id) continue;
    const seen = lines.get(row.ingredient_id);
    if (!seen) {
      lines.set(row.ingredient_id, {
        ingredient_id: row.ingredient_id,
        quantity: row.quantity,
        unit: row.unit,
        use_soon: row.use_soon,
      });
      continue;
    }
    const adds = seen.quantity !== null && row.quantity !== null && seen.unit === row.unit;
    lines.set(row.ingredient_id, {
      ingredient_id: row.ingredient_id,
      quantity: adds ? (seen.quantity ?? 0) + (row.quantity ?? 0) : null,
      unit: adds ? seen.unit : null,
      use_soon: seen.use_soon || row.use_soon,
    });
  }
  return [...lines.values()];
}

/** The centre of the pantry's ingredients in the embedding space. No model is called for it. */
async function pantryVector(db: Db, ids: string[]) {
  if (ids.length === 0) return null;
  const rows = await db
    .select({ embedding: ingredients.embedding })
    .from(ingredients)
    .where(and(inArray(ingredients.id, ids), isNotNull(ingredients.embedding)));
  const vectors = rows.flatMap((row) => (row.embedding ? [row.embedding] : []));
  const first = vectors[0];
  if (!first) return null;
  const mean = new Array<number>(first.length).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < mean.length; i += 1)
      mean[i] = (mean[i] ?? 0) + (vector[i] ?? 0) / vectors.length;
  }
  return mean;
}

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** The one line under a result, built from its lists. It states facts; nothing is generated. */
export function reasonFor(result: Scored, name: (id: string) => string) {
  const parts: string[] = [];
  const used = result.have.slice(0, 3);
  if (used.length > 0) parts.push(`Uses the ${list(used.map(name))}`);
  for (const swap of result.substituted.slice(0, 2)) {
    parts.push(`${name(swap.substitute_id)} in place of ${name(swap.ingredient_id)}`);
  }
  if (result.missing.length > 0 && result.missing.length <= 2) {
    parts.push(`works without the ${list(result.missing.map(name))}`);
  }
  return parts.join("; ");
}

export type SuggestDeps = { db: Db; llm: Llm; corpus: CorpusReader };

/**
 * Answers "what can we cook": a new run from the live pantry, or the next page of an earlier
 * run from the pantry as it was then.
 */
export async function suggest(
  { db, llm, corpus }: SuggestDeps,
  household: Household,
  profile: HouseholdProfile,
  input: SuggestInput,
  cursor: string | undefined,
): Promise<SuggestResponse | undefined> {
  const [earlier] = cursor
    ? await db
        .select()
        .from(suggestionRuns)
        .where(and(eq(suggestionRuns.id, cursor), eq(suggestionRuns.household_id, household.id)))
    : [];
  if (cursor && !earlier) return undefined;

  const request: SuggestRequest = earlier?.request ?? {
    time_budget_min: input.time_budget_min ?? profile.default_time_min,
    servings: input.servings ?? profile.default_servings,
    effort: input.effort ?? profile.effort,
    use_up: input.use_up ?? [],
    craving: input.craving?.trim() || null,
    mc_only: input.mc_only ?? false,
    official_only: input.official_only ?? false,
  };
  const pantry = earlier?.pantry_snapshot ?? (await snapshot(db, household.id));
  const loaded = await corpus.read();
  const visible = visibleCorpus(loaded, household.id, request.official_only ?? false);
  const [cravingVector] = request.craving
    ? await llm.embed([request.craving], {
        endpoint: "suggestions.craving",
        household_id: household.id,
      })
    : [];
  const { ranked, near } = rank(
    visible,
    {
      pantry,
      profile,
      pantryVector: await pantryVector(
        db,
        pantry.map((line) => line.ingredient_id),
      ),
      cravingVector: cravingVector ?? null,
    },
    request,
  );

  const facts = new Map(visible.recipes.map((r) => [r.recipe_version_id, r]));
  const source = (versionId: string) => {
    const owner = loaded.owners.get(versionId);
    return owner ? sourceOf(owner, household.id) : "official";
  };
  const shown = new Set(earlier?.results.map((r) => r.recipe_version_id));
  const { picked, more } = pickVaried(ranked, facts, shown, PAGE_SIZE);
  const name = (id: string) => loaded.ingredients.get(id)?.name ?? "";
  const page = picked.map((result) => ({ ...result, reason: reasonFor(result, name) }));

  const stored = page.map(({ disliked: _disliked, ...result }) => result);
  let run_id = earlier?.id;
  if (earlier) {
    await db
      .update(suggestionRuns)
      .set({ results: [...earlier.results, ...stored] })
      .where(eq(suggestionRuns.id, earlier.id));
  } else {
    const [run] = await db
      .insert(suggestionRuns)
      .values({ household_id: household.id, request, pantry_snapshot: pantry, results: stored })
      .returning({ id: suggestionRuns.id });
    run_id = run?.id;
  }
  if (!run_id) throw new Error("suggestion run insert returned nothing");

  const results: SuggestionCard[] = page.flatMap((result) => {
    const display = loaded.display.get(result.recipe_version_id);
    const recipe = facts.get(result.recipe_version_id);
    return display && recipe
      ? [
          {
            ...result,
            ...display,
            has_device_variant: recipe.has_device_variant,
            source: source(result.recipe_version_id),
          },
        ]
      : [];
  });
  const closest: NearMiss[] =
    !earlier && ranked.length < FEW_RESULTS
      ? near.slice(0, NEAR_SHOWN).flatMap((miss) => {
          const display = loaded.display.get(miss.recipe_version_id);
          return display
            ? [
                {
                  ...miss,
                  recipe_id: display.recipe_id,
                  title: display.title,
                  image: display.image,
                  source: source(miss.recipe_version_id),
                },
              ]
            : [];
        })
      : [];
  const mentioned = new Set([
    ...results.flatMap((r) => [
      ...r.have,
      ...r.missing,
      ...r.uses_use_soon,
      ...r.disliked,
      ...r.substituted.flatMap((s) => [s.ingredient_id, s.substitute_id]),
    ]),
    ...closest.flatMap((c) => c.missing_core),
  ]);
  return {
    run_id,
    results,
    closest,
    names: Object.fromEntries([...mentioned].map((id) => [id, name(id)])),
    next_cursor: more ? run_id : null,
  };
}
