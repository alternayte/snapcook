import { foldName } from "@snapcook/db";
import {
  type DeviceCapabilities,
  type DeviceVariantDraft,
  type DishCandidate,
  type Ingredient,
  type RecipeDraft,
  toGrams,
  type ValidationReport,
} from "@snapcook/schema";
import type { PipelineConfig } from "./config";
import { BASE_SERVINGS } from "./write";

type Problem = ValidationReport["problems"][number];
export type IngredientIndex = Map<string, Ingredient>;

/** Every name and alias, folded, pointing at its ingredient. */
export function indexIngredients(ingredients: Ingredient[]): IngredientIndex {
  const index: IngredientIndex = new Map();
  for (const ingredient of ingredients) {
    for (const name of [ingredient.name, ...ingredient.aliases])
      index.set(foldName(name), ingredient);
  }
  return index;
}

// A step list may run this far over or under the stated total before it counts as a mismatch.
const TIME_TOLERANCE = 0.25;
const TIME_SLACK_MIN = 10;

/** Deterministic checks on a written recipe. An empty list means the draft may go to review. */
export function validateDraft(
  draft: RecipeDraft,
  dish: Pick<DishCandidate, "primary_protein" | "dish_type">,
  index: IngredientIndex,
  config: Pick<PipelineConfig, "tags" | "bands" | "edible_share">,
): Problem[] {
  const problems: Problem[] = [];
  const add = (code: string, message: string) => problems.push({ code, message });

  if (!draft.ingredients.some((i) => i.role === "core")) {
    add("no_core", "No ingredient has the role core. Mark what defines the dish as core.");
  }
  for (const line of draft.ingredients) {
    if (!index.has(foldName(line.ingredient))) {
      add(
        "unknown_ingredient",
        `"${line.ingredient}" is not a canonical ingredient name. Use a name from the list.`,
      );
    }
    if ((line.quantity === null) !== (line.unit === null)) {
      add("quantity_unit", `"${line.ingredient}" needs both a quantity and a unit, or neither.`);
    }
    if (line.role !== "core" && line.substitutes.length > 0) {
      add("substitute_role", `"${line.ingredient}" is not core, so it must not list substitutes.`);
    }
    for (const substitute of line.substitutes) {
      if (!index.has(foldName(substitute))) {
        add(
          "unknown_substitute",
          `Substitute "${substitute}" for "${line.ingredient}" is not a canonical ingredient name.`,
        );
      }
    }
  }

  for (const band of config.bands) {
    if (band.dish_proteins.length > 0 && !band.dish_proteins.includes(dish.primary_protein))
      continue;
    if (band.dish_types.length > 0 && !band.dish_types.includes(dish.dish_type)) continue;
    let grams = 0;
    let counted = 0;
    for (const line of draft.ingredients) {
      const ingredient = index.get(foldName(line.ingredient));
      if (!ingredient || !band.categories.includes(ingredient.category)) continue;
      if (!band.roles.includes(line.role) || line.quantity === null || line.unit === null) continue;
      const g = toGrams(line.quantity, line.unit, ingredient);
      if (g === null) continue;
      grams += g * (config.edible_share[ingredient.name] ?? 1);
      counted += 1;
    }
    if (counted === 0) continue;
    const perServing = Math.round(grams / BASE_SERVINGS);
    if (perServing < band.min_g || perServing > band.max_g) {
      add(
        "quantity_band",
        `${band.label} is ${perServing} g per serving; the plausible range is ${band.min_g} to ${band.max_g} g. Check the quantities for ${BASE_SERVINGS} servings.`,
      );
    }
  }

  draft.steps.forEach((step, i) => {
    if (step.index !== i)
      add(
        "step_index",
        `Step ${i} has index ${step.index}. Indexes start at 0 and count up by one.`,
      );
    if (step.kind === "mc" || step.mc !== undefined) {
      add(
        "device_step",
        `Step ${i} is a device step. The generic recipe uses only prep, pan, oven and rest.`,
      );
    }
    if ((step.kind === "pan" || step.kind === "oven") && step.minutes === undefined) {
      add("missing_minutes", `Step ${i} is a ${step.kind} step with no minutes.`);
    }
  });

  if (draft.time_active_min > draft.time_total_min) {
    add("time_active", "time_active_min is larger than time_total_min.");
  }
  const mainMinutes = draft.steps
    .filter((s) => s.lane === "main")
    .reduce((sum, s) => sum + (s.minutes ?? 0), 0);
  const slack = Math.max(TIME_SLACK_MIN, draft.time_total_min * TIME_TOLERANCE);
  if (Math.abs(mainMinutes - draft.time_total_min) > slack) {
    add(
      "time_total",
      `The main-lane steps add up to ${mainMinutes} min but time_total_min is ${draft.time_total_min}. Make them agree.`,
    );
  }

  for (const tag of draft.tags) {
    if (!config.tags.includes(tag)) add("unknown_tag", `"${tag}" is not an allowed tag.`);
  }
  return problems;
}

/** Checks a device variant against what the device can do. */
export function validateVariant(
  variant: DeviceVariantDraft,
  device: DeviceCapabilities,
): Problem[] {
  const problems: Problem[] = [];
  const add = (code: string, message: string) => problems.push({ code, message });
  const deviceSteps = variant.steps.filter((s) => s.kind === "mc");

  if (variant.suitability === "unsuitable") {
    if (variant.steps.length > 0)
      add("unsuitable_steps", "An unsuitable dish must have no device steps.");
    return problems;
  }
  if (deviceSteps.length === 0) {
    add("no_device_step", `Suitability is ${variant.suitability} but no step uses the device.`);
  }
  variant.steps.forEach((step, i) => {
    if (step.index !== i)
      add(
        "step_index",
        `Step ${i} has index ${step.index}. Indexes start at 0 and count up by one.`,
      );
    if ((step.kind === "mc") !== (step.mc !== undefined)) {
      add(
        "device_settings",
        `Step ${i}: a device step needs its settings, and only a device step may have them.`,
      );
    }
    if ((step.kind === "pan" || step.kind === "oven") && step.minutes === undefined) {
      add(
        "missing_minutes",
        `Step ${i} is a ${step.kind} step with no minutes. Give minutes for every timed step.`,
      );
    }
    const mc = step.mc;
    if (!mc) return;
    if (step.minutes !== mc.minutes) {
      add(
        "device_minutes",
        `Step ${i}: the step's minutes and the device settings' minutes must be the same number.`,
      );
    }
    if (mc.temp_c < device.temp_c.min || mc.temp_c > device.temp_c.max) {
      add(
        "device_temp",
        `Step ${i}: ${mc.temp_c} °C is outside the device range ${device.temp_c.min} to ${device.temp_c.max} °C.`,
      );
    }
    if (mc.speed < device.speed.min || mc.speed > device.speed.max) {
      add(
        "device_speed",
        `Step ${i}: speed ${mc.speed} is outside the device range ${device.speed.min} to ${device.speed.max}.`,
      );
    }
    if (mc.reverse && mc.speed > device.reverse_max_speed) {
      add(
        "device_reverse",
        `Step ${i}: reverse works only up to speed ${device.reverse_max_speed}.`,
      );
    }
    if (mc.accessory === "butterfly" && mc.speed > device.whisk_max_speed) {
      add(
        "device_whisk",
        `Step ${i}: the butterfly whisk works only up to speed ${device.whisk_max_speed}.`,
      );
    }
    const limit = device.time_limits.find((l) => mc.speed <= l.up_to_speed);
    if (limit && mc.minutes > limit.max_minutes) {
      add(
        "device_time",
        `Step ${i}: ${mc.minutes} min at speed ${mc.speed} is over the device limit of ${limit.max_minutes} min. Split the step.`,
      );
    }
  });
  return problems;
}
