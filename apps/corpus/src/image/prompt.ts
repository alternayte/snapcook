import type { DeviceStep, IngredientRole } from "@snapcook/schema";
import { z } from "zod";
import type { ImageConfig } from "./config";

export type Pictured = {
  title: string;
  description: string;
  dish_type: string;
  steps: DeviceStep[];
  ingredients: { name: string; prep: string | null; role: IngredientRole }[];
};

const named = (lines: Pictured["ingredients"], roles: IngredientRole[]) =>
  lines
    .filter((l) => roles.includes(l.role))
    .map((l) => (l.prep ? `${l.name} (${l.prep})` : l.name))
    .join("; ");

/** What the recipe says is on the plate. The picture prompt and the check both start from it. */
function facts(recipe: Pictured) {
  const last = recipe.steps.filter((s) => s.lane === "main").at(-1);
  const optional = named(recipe.ingredients, ["optional"]);
  return [
    `Dish: ${recipe.title}. ${recipe.description}`,
    `Ingredients: ${named(recipe.ingredients, ["core", "supporting"])}`,
    ...(optional ? [`Optional in the recipe: ${optional}`] : []),
    ...(last ? [`How it is finished: ${last.text}`] : []),
  ];
}

/** The brief for one picture: the shared style, then only what this recipe contains. */
export function imagePrompt(config: ImageConfig, recipe: Pictured, faults: string[] = []) {
  return [
    config.style,
    `Camera angle: ${config.angles[recipe.dish_type] ?? config.angles.default}`,
    "",
    ...facts(recipe),
    "",
    config.forbid,
    ...(faults.length > 0
      ? [
          "",
          "An earlier picture had these faults. Avoid every one:",
          ...faults.map((f) => `- ${f}`),
        ]
      : []),
  ].join("\n");
}

export const ImageCheck = z.object({
  /** Core ingredients a cook would clearly see in the real dish that the picture does not show. */
  missing: z.array(z.string().min(1)),
  /** Foods in the picture that the recipe does not list. */
  extras: z.array(z.string().min(1)),
  /** Signs that the picture is not a usable photograph. */
  defects: z.array(z.string().min(1)),
});
export type ImageCheck = z.infer<typeof ImageCheck>;

export const checkHint = (config: ImageConfig, recipe: Pictured) =>
  [config.check, "", ...facts(recipe)].join("\n");

export const faultsOf = (check: ImageCheck) => [
  ...check.missing.map((m) => `missing from the picture: ${m}`),
  ...check.extras.map((e) => `not in the recipe: ${e}`),
  ...check.defects,
];
