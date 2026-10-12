import { type Db, schema } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import type {
  AdaptationControls,
  AdaptRequest,
  AdaptResponse,
  Household,
  HouseholdProfile,
  RecipeView,
} from "@snapcook/schema";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { PLANS } from "../billing/plans";
import { AllowanceUsedUp, consume } from "../billing/usage";
import {
  ADAPT_SYSTEM,
  AdaptedDraft,
  adaptationPrompt,
  assemble,
  draftProblems,
  inputHash,
  type KitchenFacts,
  plan,
  type RecipeFacts,
  sourceDraft,
} from "./adapt";

const {
  adaptations,
  deviceProfiles,
  ingredientSubstitutes,
  ingredients,
  pantryItems,
  recipeDeviceVariants,
  recipeImages,
  recipeIngredients,
  recipes,
  recipeVersions,
} = schema;

const SERVABLE = ["auto_reviewed", "human_reviewed", "test_cooked"] as const;
// The first answer, and one more try with the faults named.
const MAX_TRIES = 2;

export class AdaptationRefused extends Error {
  constructor(readonly problems: string[]) {
    super("the adaptation broke the rules twice");
  }
}

async function versionRow(db: Db, where: { recipeId: string } | { versionId: string }) {
  const [row] = await db
    .select({
      version: recipeVersions,
      suitability: recipeDeviceVariants.suitability,
      deviceSteps: recipeDeviceVariants.steps,
      image: recipeImages.file,
    })
    .from(recipes)
    .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
    .leftJoin(recipeDeviceVariants, eq(recipeDeviceVariants.recipe_version_id, recipeVersions.id))
    .leftJoin(recipeImages, eq(recipeImages.recipe_version_id, recipeVersions.id))
    .where(
      and(
        inArray(recipes.status, [...SERVABLE]),
        "recipeId" in where
          ? eq(recipes.id, where.recipeId)
          : eq(recipeVersions.id, where.versionId),
      ),
    );
  if (!row) return undefined;
  const lines = await db
    .select({
      ingredient_id: recipeIngredients.ingredient_id,
      name: ingredients.name,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      prep: recipeIngredients.prep,
      role: recipeIngredients.role,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredient_id))
    .where(eq(recipeIngredients.recipe_version_id, row.version.id))
    .orderBy(asc(recipeIngredients.position));
  const suits = row.suitability === "native" || row.suitability === "partial";
  return { ...row, lines, deviceSteps: suits ? row.deviceSteps : null };
}

/** The recipe as written, for any signed-in household. */
export async function recipeView(db: Db, recipeId: string): Promise<RecipeView | undefined> {
  const row = await versionRow(db, { recipeId });
  if (!row) return undefined;
  const { version } = row;
  return {
    recipe_id: version.recipe_id,
    recipe_version_id: version.id,
    title: version.title,
    description: version.description,
    cuisine: version.cuisine,
    time_total_min: version.time_total_min,
    time_active_min: version.time_active_min,
    difficulty: version.difficulty,
    base_servings: version.base_servings,
    image: row.image,
    has_device_variant: row.deviceSteps !== null,
    ingredients: row.lines,
    steps: version.steps,
  };
}

export type AdaptDeps = { db: Db; llm: Llm; model: string };

/**
 * Adapts a recipe version to the household. The same inputs return the stored answer; the model
 * runs only for a new combination, and its answer is checked before it is stored or shown.
 */
export async function adapt(
  { db, llm, model }: AdaptDeps,
  household: Household,
  profile: HouseholdProfile,
  request: AdaptRequest,
): Promise<AdaptResponse | undefined> {
  const row = await versionRow(db, { versionId: request.recipe_version_id });
  if (!row) return undefined;

  const lineIds = row.lines.map((l) => l.ingredient_id);
  const swaps = await db
    .select()
    .from(ingredientSubstitutes)
    .where(inArray(ingredientSubstitutes.ingredient_id, lineIds));
  const substitutes = new Map<string, string[]>();
  for (const swap of swaps) {
    substitutes.set(swap.ingredient_id, [
      ...(substitutes.get(swap.ingredient_id) ?? []),
      swap.substitute_id,
    ]);
  }
  const pantry = await db
    .select()
    .from(pantryItems)
    .where(and(eq(pantryItems.household_id, household.id), isNotNull(pantryItems.ingredient_id)));
  const known = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      category: ingredients.category,
      allergens: ingredients.allergens,
      contains: ingredients.contains,
      grams_per_unit: ingredients.grams_per_unit,
      ml_per_unit: ingredients.ml_per_unit,
    })
    .from(ingredients)
    .where(
      inArray(ingredients.id, [
        ...lineIds,
        ...swaps.map((s) => s.substitute_id),
        ...pantry.flatMap((p) => (p.ingredient_id ? [p.ingredient_id] : [])),
      ]),
    );

  const recipe: RecipeFacts = {
    recipe_version_id: row.version.id,
    title: row.version.title,
    base_servings: row.version.base_servings,
    steps: row.version.steps,
    deviceSteps: row.deviceSteps,
    lines: row.lines,
    ingredients: new Map(known.map((i) => [i.id, i])),
    substitutes,
  };
  const kitchen: KitchenFacts = { profile, pantry };
  // A plan without adaptation controls gets the household's defaults, whatever was asked.
  const controls_locked = !PLANS[household.plan].adaptationControls;
  const asked = controls_locked ? {} : request.controls;
  const controls: AdaptationControls = {
    servings: asked.servings ?? profile.default_servings,
    device_profile_id:
      asked.device_profile_id !== undefined
        ? asked.device_profile_id
        : profile.devices.mc_smart && recipe.deviceSteps
          ? "mc_smart"
          : null,
    // A swap must name an ingredient of this recipe and an item of this household's pantry.
    swaps: (asked.swaps ?? []).filter(
      (s) => lineIds.includes(s.ingredient_id) && pantry.some((p) => p.id === s.pantry_item_id),
    ),
    toddler_safe: asked.toddler_safe ?? profile.toddler,
    lazier: asked.lazier ?? false,
  };

  const planned = plan(recipe, kitchen, controls);
  const name = (id: string) => recipe.ingredients.get(id)?.name ?? "";
  // What the household could try in place of an ingredient it lacks: pantry items of the same
  // kind that it may eat. The model decides whether the swap works and says so if it does not.
  const category = new Map(known.map((i) => [i.id, i.category]));
  const onHand = new Set(pantry.flatMap((p) => (p.ingredient_id ? [p.ingredient_id] : [])));
  const bannedIds = new Set(planned.lines.filter((l) => l.banned).map((l) => l.ingredient_id));
  const swap_options = Object.fromEntries(
    planned.lines
      .filter((l) => l.role !== "staple" && !onHand.has(l.ingredient_id))
      .map((l) => [
        l.ingredient_id,
        pantry
          .filter(
            (p) =>
              p.ingredient_id &&
              category.get(p.ingredient_id) === category.get(l.ingredient_id) &&
              !bannedIds.has(p.ingredient_id) &&
              !lineIds.includes(p.ingredient_id),
          )
          .map((p) => ({ pantry_item_id: p.id, name: p.display_name })),
      ]),
  );
  const respond = (id: string, output: AdaptResponse["recipe"]): AdaptResponse => ({
    adaptation_id: id,
    controls,
    controls_locked,
    recipe: output,
    swap_options,
  });

  const input_hash = inputHash(recipe, kitchen, controls);
  const [cached] = await db
    .select()
    .from(adaptations)
    .where(and(eq(adaptations.household_id, household.id), eq(adaptations.input_hash, input_hash)));
  if (cached) return respond(cached.id, cached.output);

  const store = async (output: AdaptResponse["recipe"], by: string, cost_usd: number) => {
    const [saved] = await db
      .insert(adaptations)
      .values({
        household_id: household.id,
        recipe_version_id: recipe.recipe_version_id,
        input_hash,
        controls,
        output,
        model: by,
        cost_usd,
      })
      // Two opens at the same moment store one row; the second reads the first.
      .onConflictDoUpdate({
        target: [adaptations.household_id, adaptations.input_hash],
        set: { input_hash },
      })
      .returning();
    if (!saved) throw new Error("adaptation insert returned nothing");
    return respond(saved.id, saved.output);
  };

  // A defining ingredient the household must not eat, with nothing to replace it: say so. No
  // model can fix that, so none is asked.
  if (planned.blocked) {
    const refused = {
      control: "profile",
      reason: `This dish depends on ${name(planned.blocked.ingredient_id)}, which your household does not eat, and nothing in the pantry can replace it.`,
    };
    return store(assemble(sourceDraft(planned, refused), recipe, kitchen, controls), "none", 0);
  }

  // Only a model run is counted: a stored answer and a refusal cost nothing.
  const refusal = await consume(db, household, "adaptations");
  if (refusal) throw new AllowanceUsedUp(refusal);

  const [device] = planned.withDevice
    ? await db.select().from(deviceProfiles).where(eq(deviceProfiles.id, "mc_smart"))
    : [];
  const base = adaptationPrompt(recipe, planned, kitchen, controls, device ?? null);
  let cost = 0;
  let problems: string[] = [];
  let previous: AdaptedDraft | undefined;
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    const prompt = previous
      ? [
          base,
          "",
          "Your previous answer:",
          JSON.stringify(previous),
          "",
          "It breaks these rules. Fix every one and return the full answer:",
          ...problems.map((p) => `- ${p}`),
        ].join("\n")
      : base;
    const draft = await llm.structured({ system: ADAPT_SYSTEM, prompt }, AdaptedDraft, {
      endpoint: "adaptations",
      household_id: household.id,
      role: "adapt",
      onCost: (usd) => {
        cost += usd;
      },
    });
    problems = draftProblems(draft, planned, device?.capabilities ?? null);
    if (problems.length === 0) {
      return store(assemble(draft, recipe, kitchen, controls), model, cost);
    }
    previous = draft;
  }
  throw new AdaptationRefused(problems);
}
