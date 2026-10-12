import { createHash } from "node:crypto";
import {
  type AdaptationControls,
  type AdaptedRecipe,
  type Allergen,
  convert,
  type DeviceCapabilities,
  DeviceStep,
  type DietFlag,
  deviceStepProblems,
  type HouseholdProfile,
  Id,
  type IngredientRole,
  type PantryItem,
  Quantity,
  roundKitchen,
  Unit,
} from "@snapcook/schema";
import { z } from "zod";
import { createBanCheck } from "../household/diet";

export type Line = {
  ingredient_id: string;
  quantity: number | null;
  unit: Unit | null;
  prep: string | null;
  role: IngredientRole;
};

export type IngredientFacts = {
  id: string;
  name: string;
  allergens: Allergen[];
  contains: DietFlag[];
  grams_per_unit: number | null;
  ml_per_unit: number | null;
};

export type RecipeFacts = {
  recipe_version_id: string;
  title: string;
  base_servings: number;
  /** Steps for a hob and an oven. */
  steps: DeviceStep[];
  /** Steps with the device, when the dish suits it. */
  deviceSteps: DeviceStep[] | null;
  lines: Line[];
  ingredients: Map<string, IngredientFacts>;
  substitutes: Map<string, string[]>;
};

export type KitchenFacts = { profile: HouseholdProfile; pantry: PantryItem[] };

/** One recipe line as the adapter may use it: scaled, with what may stand in for it. */
export type PlannedLine = Line & { banned: boolean; standIns: string[] };

export type Plan = {
  lines: PlannedLine[];
  /** The steps the adaptation starts from. */
  source: DeviceStep[];
  withDevice: boolean;
  /** Set when a defining ingredient may not be eaten and nothing on hand can replace it. */
  blocked: { ingredient_id: string } | null;
};

// How far the number of steps may move from the source recipe.
const STEP_COUNT_SLACK = 3;
// Pantry amounts are compared in buckets this wide, so a small change keeps the cached answer.
const HASH_BUCKET = 50;

/** Works out, without a model, what the adapter is allowed to do with each ingredient. */
export function plan(
  recipe: RecipeFacts,
  kitchen: KitchenFacts,
  controls: AdaptationControls,
): Plan {
  const banned = createBanCheck(kitchen.profile, recipe.ingredients);
  const onHand = new Set([
    ...kitchen.pantry.flatMap((item) => (item.ingredient_id ? [item.ingredient_id] : [])),
    ...kitchen.profile.staples,
  ]);
  const stocked = new Set(
    kitchen.pantry.flatMap((item) => (item.ingredient_id ? [item.ingredient_id] : [])),
  );
  const pantryById = new Map(kitchen.pantry.map((item) => [item.id, item]));
  const scale = controls.servings / recipe.base_servings;
  const noAlcohol = (id: string) =>
    !controls.toddler_safe || !recipe.ingredients.get(id)?.contains.includes("alcohol");

  const lines = recipe.lines.map((line): PlannedLine => {
    const chosen = controls.swaps
      .filter((swap) => swap.ingredient_id === line.ingredient_id)
      .flatMap((swap) => pantryById.get(swap.pantry_item_id)?.ingredient_id ?? []);
    // Something really in the pantry is a better stand-in than an assumed staple.
    const listed = (recipe.substitutes.get(line.ingredient_id) ?? [])
      .filter((id) => onHand.has(id))
      .sort((a, b) => Number(stocked.has(b)) - Number(stocked.has(a)));
    return {
      ...line,
      quantity:
        line.quantity === null || line.unit === null
          ? null
          : roundKitchen(line.quantity * scale, line.unit),
      banned: banned(line.ingredient_id) || !noAlcohol(line.ingredient_id),
      // A swap the household chose comes first. Nothing banned is ever offered.
      standIns: [...new Set([...chosen, ...listed])].filter((id) => !banned(id) && noAlcohol(id)),
    };
  });
  const withDevice = controls.device_profile_id !== null && recipe.deviceSteps !== null;
  const stuck = lines.find((l) => l.role === "core" && l.banned && l.standIns.length === 0);
  return {
    lines,
    source: withDevice && recipe.deviceSteps ? recipe.deviceSteps : recipe.steps,
    withDevice,
    blocked: stuck ? { ingredient_id: stuck.ingredient_id } : null,
  };
}

/**
 * The key of a cached adaptation: the recipe, the controls, the parts of the profile that change
 * the result, and the pantry lines this recipe can use.
 */
export function inputHash(
  recipe: RecipeFacts,
  kitchen: KitchenFacts,
  controls: AdaptationControls,
) {
  const relevant = new Set(
    recipe.lines.flatMap((l) => [
      l.ingredient_id,
      ...(recipe.substitutes.get(l.ingredient_id) ?? []),
    ]),
  );
  const { profile } = kitchen;
  const key = {
    version: recipe.recipe_version_id,
    controls: {
      ...controls,
      swaps: [...controls.swaps].sort((a, b) => a.ingredient_id.localeCompare(b.ingredient_id)),
    },
    profile: {
      allergens: profile.allergens.map((a) => a.value).sort(),
      cannot_eat: [...profile.cannot_eat].sort(),
      dislikes: [...profile.dislikes].sort(),
      diet: profile.diet_style,
      staples: [...profile.staples].filter((id) => relevant.has(id)).sort(),
    },
    pantry: kitchen.pantry
      .filter((item) => item.ingredient_id && relevant.has(item.ingredient_id))
      .map((item) => [
        item.id,
        item.ingredient_id,
        item.quantity === null ? null : Math.floor(item.quantity / HASH_BUCKET),
        item.unit,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

/** What the model returns. The server works out pantry status and deductions itself. */
export const AdaptedDraft = z.object({
  ingredients: z.array(
    z.object({
      ingredient_id: Id,
      quantity: Quantity.nullable(),
      unit: Unit.nullable(),
      /** The recipe ingredient this one replaces, or null when it is the recipe's own. */
      substituted_for: Id.nullable(),
    }),
  ),
  steps: z.array(DeviceStep).min(1),
  tips: z.array(z.string().min(1)),
  toddler_notes: z.array(z.string().min(1)),
  /** Set when a control cannot be honoured. The recipe is still returned without that change. */
  refused: z.object({ control: z.string().min(1), reason: z.string().min(1) }).nullable(),
});
export type AdaptedDraft = z.infer<typeof AdaptedDraft>;

export const ADAPT_SYSTEM = [
  "You adapt one established recipe for one household. You get the recipe, what the household has, its rules, and the controls it chose.",
  "You may change quantities, use a listed stand-in, reword steps and change device settings. You may not change what the dish is.",
  "Rules:",
  "1. Return every ingredient the dish uses. Use only ingredient ids from the input: the recipe's own, or one from that ingredient's stand_ins list. For a stand-in, set substituted_for to the id it replaces.",
  "2. An ingredient marked banned must not appear. Use one of its stand_ins. If it has none and its role is not core, leave it out and adjust the steps.",
  "3. Never drop or replace a core ingredient that is not banned, unless the household chose a swap for it (it is then first in stand_ins).",
  "4. When an ingredient is not on hand but a stand_in is, use the first stand_in that suits the dish: the list is in order of preference. Adjust its quantity where the stand-in is stronger or weaker.",
  "5. Quantities are already scaled to the servings. Keep them unless a stand-in or a control needs a change. Use the same units.",
  "6. Steps: rewrite the source steps for the final ingredients and quantities. Keep the order, the lanes and the kinds. index starts at 0 and counts up by one. Every timed step has minutes. Name quantities in the step text.",
  "7. Device steps (kind 'mc') must stay inside the device capabilities given. When no device is given, there must be no 'mc' step and no mc field.",
  "8. toddler_safe: no alcohol at all, salt halved and added at the table for adults, chilli removed or served on the side, and soft textures. Put what the adults can add back in toddler_notes. Flag choking risks there.",
  "9. lazier: skip optional searing and use one pot where the dish still works. Never skip a step the dish depends on.",
  "10. If a control cannot be honoured without breaking a rule, do not invent. Set refused with the control and a one-sentence reason, and return the recipe without that change. Otherwise refused is null.",
  "11. tips: up to three short, practical points for this adapted version. Do not repeat the steps.",
  "Write in British English. Do not mention brands.",
].join("\n");

export function adaptationPrompt(
  recipe: RecipeFacts,
  planned: Plan,
  kitchen: KitchenFacts,
  controls: AdaptationControls,
  device: { name: string; capabilities: DeviceCapabilities } | null,
) {
  const name = (id: string) => recipe.ingredients.get(id)?.name ?? id;
  const stocked = new Set(
    kitchen.pantry.flatMap((i) => (i.ingredient_id ? [i.ingredient_id] : [])),
  );
  const staples = new Set(kitchen.profile.staples);
  return [
    `Dish: ${recipe.title}. Servings: ${controls.servings}.`,
    `Controls: toddler_safe=${controls.toddler_safe}, lazier=${controls.lazier}, device=${planned.withDevice && device ? device.name : "none"}.`,
    `Dislikes (use less or offer to leave out in tips): ${kitchen.profile.dislikes.map(name).join(", ") || "none"}.`,
    "",
    "Ingredients:",
    JSON.stringify(
      planned.lines.map((l) => ({
        ingredient_id: l.ingredient_id,
        name: name(l.ingredient_id),
        quantity: l.quantity,
        unit: l.unit,
        prep: l.prep,
        role: l.role,
        banned: l.banned,
        on_hand: stocked.has(l.ingredient_id) || staples.has(l.ingredient_id),
        stand_ins: l.standIns.map((id) => ({ ingredient_id: id, name: name(id) })),
      })),
    ),
    "",
    ...(planned.withDevice && device
      ? [`Device: ${device.name}. Capabilities:`, JSON.stringify(device.capabilities), ""]
      : []),
    "Source steps:",
    JSON.stringify(planned.source),
  ].join("\n");
}

/** Checks a draft against the rules the model was given. An empty list means it may be shown. */
export function draftProblems(
  draft: AdaptedDraft,
  planned: Plan,
  device: DeviceCapabilities | null,
): string[] {
  const problems: string[] = [];
  const byId = new Map(planned.lines.map((l) => [l.ingredient_id, l]));
  const replaced = new Set<string>();

  for (const item of draft.ingredients) {
    if (item.substituted_for === null) {
      const line = byId.get(item.ingredient_id);
      if (!line) problems.push(`Ingredient ${item.ingredient_id} is not in the recipe.`);
      else if (line.banned)
        problems.push(`Ingredient ${item.ingredient_id} is banned and must not appear.`);
      continue;
    }
    const line = byId.get(item.substituted_for);
    if (!line) {
      problems.push(`substituted_for ${item.substituted_for} is not a recipe ingredient.`);
    } else if (!line.standIns.includes(item.ingredient_id)) {
      problems.push(`${item.ingredient_id} is not a listed stand-in for ${item.substituted_for}.`);
    } else {
      replaced.add(line.ingredient_id);
    }
  }
  const present = new Set(
    draft.ingredients.filter((i) => i.substituted_for === null).map((i) => i.ingredient_id),
  );
  for (const line of planned.lines) {
    if (
      line.role === "core" &&
      !present.has(line.ingredient_id) &&
      !replaced.has(line.ingredient_id)
    ) {
      problems.push(
        `Core ingredient ${line.ingredient_id} is missing. Keep it or use a listed stand-in.`,
      );
    }
  }
  for (const item of draft.ingredients) {
    if ((item.quantity === null) !== (item.unit === null)) {
      problems.push(
        `Ingredient ${item.ingredient_id} needs both a quantity and a unit, or neither.`,
      );
    }
  }

  if (Math.abs(draft.steps.length - planned.source.length) > STEP_COUNT_SLACK) {
    problems.push(
      `The recipe has ${draft.steps.length} steps and the source has ${planned.source.length}. Stay within ${STEP_COUNT_SLACK}.`,
    );
  }
  if (planned.withDevice && device) {
    problems.push(...deviceStepProblems(draft.steps, device).map((p) => p.message));
  } else {
    draft.steps.forEach((step, i) => {
      if (step.index !== i)
        problems.push(`Step ${i} has index ${step.index}. Count up from 0 by one.`);
      if (step.kind === "mc" || step.mc !== undefined) {
        problems.push(`Step ${i} is a device step, and no device is in use.`);
      }
    });
  }
  return problems;
}

/** The draft the recipe itself gives, with no change beyond scaling. Used when nothing is adapted. */
export function sourceDraft(planned: Plan, refused: AdaptedDraft["refused"]): AdaptedDraft {
  return {
    ingredients: planned.lines.map((l) => ({
      ingredient_id: l.ingredient_id,
      quantity: l.quantity,
      unit: l.unit,
      substituted_for: null,
    })),
    steps: planned.source,
    tips: [],
    toddler_notes: [],
    refused,
  };
}

/**
 * Turns a checked draft into what the app shows: each ingredient with where it comes from, and
 * what cooking it takes out of the pantry.
 */
export function assemble(
  draft: AdaptedDraft,
  recipe: RecipeFacts,
  kitchen: KitchenFacts,
  controls: AdaptationControls,
): AdaptedRecipe {
  const staples = new Set(kitchen.profile.staples);
  const chosen = new Map(controls.swaps.map((s) => [s.ingredient_id, s.pantry_item_id]));
  const deductions: AdaptedRecipe["deductions"] = [];

  const ingredients = draft.ingredients.map((item): AdaptedRecipe["ingredients"][number] => {
    const facts = recipe.ingredients.get(item.ingredient_id);
    const quantity =
      item.quantity === null || item.unit === null ? null : roundKitchen(item.quantity, item.unit);
    const held = kitchen.pantry.filter((p) => p.ingredient_id === item.ingredient_id);
    // The item the household picked, else one to use soon, else any.
    const picked = item.substituted_for ? chosen.get(item.substituted_for) : undefined;
    const source = held.find((p) => p.id === picked) ?? held.find((p) => p.use_soon) ?? held[0];
    const base = {
      ingredient_id: item.ingredient_id,
      display: facts?.name ?? "",
      quantity,
      unit: item.unit,
      ...(item.substituted_for ? { substituted_for: item.substituted_for } : {}),
    };
    if (!source) {
      return {
        ...base,
        status: item.substituted_for
          ? "substituted"
          : staples.has(item.ingredient_id)
            ? "staple"
            : "missing",
      };
    }
    // Take what the dish needs, in the unit the pantry item is kept in, and never more than is held.
    if (
      quantity !== null &&
      item.unit !== null &&
      source.quantity !== null &&
      source.unit !== null &&
      facts
    ) {
      const needed = convert(quantity, item.unit, source.unit, facts);
      const take =
        needed === null ? null : Math.min(Math.round(needed * 100) / 100, source.quantity);
      if (take !== null && take > 0) {
        deductions.push({ pantry_item_id: source.id, quantity: take, unit: source.unit });
      }
    }
    return {
      ...base,
      status: item.substituted_for ? "substituted" : "in_pantry",
      pantry_item_id: source.id,
    };
  });

  return {
    servings: controls.servings,
    ingredients,
    steps: draft.steps,
    deductions,
    tips: draft.tips,
    toddler_notes: draft.toddler_notes,
    ...(draft.refused ? { refused: draft.refused } : {}),
  };
}
