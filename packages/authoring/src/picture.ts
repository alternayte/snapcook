import type { CallContext, Llm } from "@snapcook/llm";
import type { DeviceStep, IngredientRole } from "@snapcook/schema";
import sharp from "sharp";
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

// One picture, and one more when the check finds a fault in the first.
const MAX_PICTURES = 2;
const WIDTH = 1280;
const CHECK_WIDTH = 768;

/** Draws one picture and has the vision model compare it with the recipe. */
export async function drawOnce(
  llm: Llm,
  config: ImageConfig,
  recipe: Pictured,
  faults: string[],
  ctx: CallContext,
) {
  const prompt = imagePrompt(config, recipe, faults);
  const drawn = await llm.image(prompt, ctx);
  const small = await sharp(drawn.data).resize({ width: CHECK_WIDTH }).jpeg().toBuffer();
  const check = await llm.vision(small, "image/jpeg", ImageCheck, checkHint(config, recipe), {
    ...ctx,
    endpoint: `${ctx.endpoint}_check`,
  });
  const webp = await sharp(drawn.data).resize({ width: WIDTH }).webp({ quality: 82 }).toBuffer();
  return { prompt, webp, faults: faultsOf(check) };
}

/**
 * Draws the picture of a recipe and checks it. A picture with faults is drawn once more with
 * them named; `webp` is null when the second one fails too.
 */
export async function drawPicture(
  llm: Llm,
  config: ImageConfig,
  recipe: Pictured,
  ctx: CallContext,
) {
  let result = await drawOnce(llm, config, recipe, [], ctx);
  for (let n = 1; n < MAX_PICTURES && result.faults.length > 0; n += 1) {
    result = await drawOnce(llm, config, recipe, result.faults, ctx);
  }
  return { ...result, webp: result.faults.length === 0 ? result.webp : null };
}
