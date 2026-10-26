import { type Db, schema } from "@snapcook/db";
import type {
  BrowseCard,
  BrowseQuery,
  BrowseResponse,
  Household,
  HouseholdProfile,
} from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createAssessor } from "../suggestions/rank";
import { type CorpusReader, snapshot, visibleCorpus } from "../suggestions/service";
import { sourceOf } from "./visibility";

const { savedRecipes } = schema;

// The same rule the suggestions use for a lazy cook.
const LAZY_MAX_ACTIVE_MIN = 20;
const LAZY_MAX_DIFFICULTY = 1;

/** Every recipe the household may see that passes the filters, with what it has for each. */
export async function browse(
  db: Db,
  corpus: CorpusReader,
  household: Household,
  profile: HouseholdProfile,
  query: BrowseQuery,
): Promise<BrowseResponse> {
  const loaded = await corpus.read();
  const visible = visibleCorpus(loaded, household.id);
  const assess = createAssessor(visible, {
    pantry: await snapshot(db, household.id),
    profile,
    pantryVector: null,
    cravingVector: null,
  });
  const saved =
    query.source === "saved"
      ? new Set(
          (
            await db
              .select({ id: savedRecipes.recipe_id })
              .from(savedRecipes)
              .where(eq(savedRecipes.household_id, household.id))
          ).map((row) => row.id),
        )
      : undefined;
  const words = query.q?.toLowerCase();
  const name = (id: string) => loaded.ingredients.get(id)?.name ?? "";
  const fitsOnly = query.fits ?? true;

  const cards: BrowseCard[] = [];
  for (const recipe of visible.recipes) {
    const display = loaded.display.get(recipe.recipe_version_id);
    const owner = loaded.owners.get(recipe.recipe_version_id);
    if (!display || !owner) continue;
    const source = sourceOf(owner, household.id);
    if (saved ? !saved.has(display.recipe_id) : query.source && query.source !== source) continue;
    if (query.cuisine && recipe.cuisine !== query.cuisine) continue;
    if (query.max_time && recipe.time_total_min > query.max_time) continue;
    if (query.mc_only && !recipe.has_device_variant) continue;
    if (
      query.effort === "lazy" &&
      (recipe.time_active_min > LAZY_MAX_ACTIVE_MIN || recipe.difficulty > LAZY_MAX_DIFFICULTY)
    ) {
      continue;
    }
    if (
      words &&
      !display.title.toLowerCase().includes(words) &&
      !recipe.cuisine.replaceAll("_", " ").includes(words) &&
      !recipe.lines.some((line) => name(line.ingredient_id).includes(words))
    ) {
      continue;
    }
    const found = assess(recipe);
    if (fitsOnly && found.ruledOut) continue;
    cards.push({
      ...display,
      recipe_version_id: recipe.recipe_version_id,
      has_device_variant: recipe.has_device_variant,
      source,
      have: found.have.length + found.substituted.length,
      missing: [...found.missingCore, ...found.missing],
      fits: !found.ruledOut,
    });
  }

  const share = (card: BrowseCard) => card.have / Math.max(1, card.have + card.missing.length);
  cards.sort((a, b) =>
    query.sort === "title"
      ? a.title.localeCompare(b.title)
      : share(b) - share(a) ||
        a.missing.length - b.missing.length ||
        a.title.localeCompare(b.title),
  );
  const mentioned = new Set(cards.flatMap((card) => card.missing));
  return {
    cards,
    names: Object.fromEntries([...mentioned].map((id) => [id, name(id)])),
    cuisines: [...new Set(visible.recipes.map((recipe) => recipe.cuisine))].sort(),
  };
}
