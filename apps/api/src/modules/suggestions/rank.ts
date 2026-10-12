import {
  type Allergen,
  type DietFlag,
  type DietStyle,
  type HouseholdProfile,
  type IngredientRole,
  type PantrySnapshotLine,
  type SuggestionResult,
  type SuggestRequest,
  toGrams,
  type Unit,
} from "@snapcook/schema";

export type CorpusIngredient = {
  id: string;
  name: string;
  allergens: Allergen[];
  contains: DietFlag[];
  grams_per_unit: number | null;
  ml_per_unit: number | null;
};

export type CorpusRecipe = {
  recipe_version_id: string;
  primary_protein: string;
  technique: string;
  cuisine: string;
  time_total_min: number;
  time_active_min: number;
  difficulty: number;
  base_servings: number;
  has_device_variant: boolean;
  embedding: number[] | null;
  lines: {
    ingredient_id: string;
    quantity: number | null;
    unit: Unit | null;
    role: IngredientRole;
  }[];
};

export type Corpus = {
  recipes: CorpusRecipe[];
  ingredients: Map<string, CorpusIngredient>;
  /** For an ingredient, what can stand in for it. */
  substitutes: Map<string, string[]>;
};

export type Kitchen = {
  pantry: PantrySnapshotLine[];
  profile: Pick<
    HouseholdProfile,
    "allergens" | "cannot_eat" | "dislikes" | "diet_style" | "staples"
  >;
  /** Where the pantry sits in the embedding space, or null when nothing in it is embedded. */
  pantryVector: number[] | null;
  cravingVector: number[] | null;
};

export type Scored = SuggestionResult & { disliked: string[] };
export type Near = { recipe_version_id: string; missing_core: string[] };

const WEIGHTS = { supporting: 0.6, useSoon: 0.2, similarity: 0.15, effort: 0.05, dislike: 0.3 };
// A pantry item this many times larger than the recipe needs counts as one to use up.
const LARGE_FACTOR = 2;
// A lazy cook wants a simple dish with little hands-on time.
const LAZY_MAX_ACTIVE_MIN = 20;
const LAZY_MAX_DIFFICULTY = 1;
// A dish that lacks at most this many core ingredients is a near miss.
const NEAR_MAX_MISSING = 2;

const FORBIDDEN: Record<DietStyle, DietFlag[]> = {
  none: [],
  pescatarian: ["meat", "pork"],
  vegetarian: ["meat", "pork", "fish", "shellfish"],
  vegan: ["meat", "pork", "fish", "shellfish", "dairy", "egg", "honey"],
  halal: ["pork", "alcohol"],
  kosher: ["pork", "shellfish"],
};

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * Ranks every dish the household can make now, best fit first, and lists the near misses.
 * No model is called: everything comes from the corpus, the pantry and the profile.
 */
export function rank(
  corpus: Corpus,
  kitchen: Kitchen,
  request: SuggestRequest,
): { ranked: Scored[]; near: Near[] } {
  const { profile } = kitchen;
  const stocked = new Map(kitchen.pantry.map((line) => [line.ingredient_id, line]));
  const available = new Set([...stocked.keys(), ...profile.staples]);
  const allergens = new Set(profile.allergens.map((a) => a.value));
  const cannotEat = new Set(profile.cannot_eat);
  const dislikes = new Set(profile.dislikes);
  const forbidden = new Set(FORBIDDEN[profile.diet_style]);
  const useUp = new Set(request.use_up);

  const banned = (id: string) => {
    const ingredient = corpus.ingredients.get(id);
    return (
      cannotEat.has(id) ||
      ingredient === undefined ||
      ingredient.allergens.some((a) => allergens.has(a)) ||
      ingredient.contains.some((flag) => forbidden.has(flag))
    );
  };
  /** Something on hand that may be eaten and can stand in for the ingredient. */
  const standIn = (id: string) =>
    (corpus.substitutes.get(id) ?? []).find((s) => available.has(s) && !banned(s));
  const flags = (id: string) => corpus.ingredients.get(id)?.contains ?? [];

  const ranked: Scored[] = [];
  const near: Near[] = [];

  for (const recipe of corpus.recipes) {
    if (recipe.time_total_min > request.time_budget_min) continue;
    if (request.mc_only && !recipe.has_device_variant) continue;
    // An optional ingredient can be left out, so it never rules a dish out.
    const needed = recipe.lines.filter((line) => line.role !== "optional");
    // Kosher also forbids meat and dairy in one dish.
    if (
      profile.diet_style === "kosher" &&
      needed.some((l) => flags(l.ingredient_id).includes("meat")) &&
      needed.some((l) => flags(l.ingredient_id).includes("dairy"))
    ) {
      continue;
    }

    const have: string[] = [];
    const missing: string[] = [];
    const missingCore: string[] = [];
    const substituted: Scored["substituted"] = [];
    const disliked: string[] = [];
    let ruledOut = false;
    let supporting = 0;
    let supportingCovered = 0;

    for (const line of needed) {
      const id = line.ingredient_id;
      const isBanned = banned(id);
      const direct = !isBanned && available.has(id);
      const swap = direct ? undefined : standIn(id);
      if (isBanned && !swap) {
        ruledOut = true;
        break;
      }
      if (line.role === "supporting") supporting += 1;
      if (direct) {
        if (line.role !== "staple") have.push(id);
        if (line.role === "supporting") supportingCovered += 1;
        if (dislikes.has(id)) disliked.push(id);
      } else if (swap) {
        substituted.push({ ingredient_id: id, substitute_id: swap });
        if (line.role === "supporting") supportingCovered += 1;
      } else if (line.role === "core") {
        missingCore.push(id);
      } else if (line.role === "supporting") {
        missing.push(id);
      }
      // A staple that is not in the house is assumed: the profile says what the household keeps.
    }
    if (ruledOut) continue;
    if (missingCore.length > 0) {
      // Close means the household has part of what defines the dish, not none of it.
      const cores = needed.filter((line) => line.role === "core").length;
      if (missingCore.length <= NEAR_MAX_MISSING && missingCore.length < cores) {
        near.push({ recipe_version_id: recipe.recipe_version_id, missing_core: missingCore });
      }
      continue;
    }

    // What the dish takes from the pantry, directly or as a stand-in.
    const consumed = new Map<string, (typeof recipe.lines)[number]>();
    for (const line of needed) {
      const swap = substituted.find((s) => s.ingredient_id === line.ingredient_id)?.substitute_id;
      const id = swap ?? line.ingredient_id;
      if (stocked.has(id)) consumed.set(id, line);
    }
    const scale = request.servings / recipe.base_servings;
    const large = (line: PantrySnapshotLine, need: (typeof recipe.lines)[number] | undefined) => {
      const ingredient = corpus.ingredients.get(line.ingredient_id);
      if (!ingredient || !need || line.quantity === null || line.unit === null) return false;
      if (need.quantity === null || need.unit === null) return false;
      const has = toGrams(line.quantity, line.unit, ingredient);
      const needs = toGrams(need.quantity * scale, need.unit, ingredient);
      return has !== null && needs !== null && needs > 0 && has >= LARGE_FACTOR * needs;
    };
    const urgent = kitchen.pantry.filter(
      (line) =>
        line.use_soon ||
        useUp.has(line.ingredient_id) ||
        large(line, consumed.get(line.ingredient_id)),
    );
    const uses_use_soon = urgent
      .filter((line) => consumed.has(line.ingredient_id))
      .map((line) => line.ingredient_id);

    const similarity =
      recipe.embedding === null
        ? 0
        : (kitchen.pantryVector ? cosine(kitchen.pantryVector, recipe.embedding) : 0) +
          (kitchen.cravingVector ? cosine(kitchen.cravingVector, recipe.embedding) : 0);
    const effortMatch =
      request.effort === "normal" ||
      (recipe.time_active_min <= LAZY_MAX_ACTIVE_MIN && recipe.difficulty <= LAZY_MAX_DIFFICULTY);

    const score =
      WEIGHTS.supporting * (supporting === 0 ? 1 : supportingCovered / supporting) +
      WEIGHTS.useSoon * (urgent.length === 0 ? 0 : uses_use_soon.length / urgent.length) +
      WEIGHTS.similarity * similarity +
      WEIGHTS.effort * (effortMatch ? 1 : 0) -
      WEIGHTS.dislike * disliked.length;

    ranked.push({
      recipe_version_id: recipe.recipe_version_id,
      score: Math.round(score * 10000) / 10000,
      have,
      missing,
      substituted,
      uses_use_soon,
      disliked,
      reason: "",
    });
  }

  // Ties break on the id, so the same kitchen always gets the same order.
  ranked.sort(
    (a, b) => b.score - a.score || a.recipe_version_id.localeCompare(b.recipe_version_id),
  );
  near.sort(
    (a, b) =>
      a.missing_core.length - b.missing_core.length ||
      a.recipe_version_id.localeCompare(b.recipe_version_id),
  );
  return { ranked, near };
}

type Varied = { primary_protein: string; technique: string; cuisine: string };

/** Two dishes are different enough when at least two of protein, technique and cuisine differ. */
const distinct = (a: Varied, b: Varied) =>
  Number(a.primary_protein !== b.primary_protein) +
    Number(a.technique !== b.technique) +
    Number(a.cuisine !== b.cuisine) >=
  2;

/**
 * Walks the ranked dishes in order, passes over those already shown, and takes up to `count`
 * that differ enough from each other. `more` says whether any dish is left for a later page.
 */
export function pickVaried<T extends { recipe_version_id: string }>(
  ranked: T[],
  facts: Map<string, Varied>,
  shown: Set<string>,
  count: number,
): { picked: T[]; more: boolean } {
  const picked: T[] = [];
  let left = 0;
  for (const candidate of ranked) {
    const own = facts.get(candidate.recipe_version_id);
    if (!own || shown.has(candidate.recipe_version_id)) continue;
    const clashes = picked.some((p) => {
      const other = facts.get(p.recipe_version_id);
      return other !== undefined && !distinct(own, other);
    });
    if (picked.length < count && !clashes) picked.push(candidate);
    else left += 1;
  }
  return { picked, more: left > 0 };
}
