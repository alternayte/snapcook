import { z } from "zod";

/** The private file that holds the grid's vocabulary and prompt text. */
export const GridConfig = z.object({
  /** Instructions that apply to every cuisine. */
  system: z.string().min(1),
  dishes_per_cuisine: z.number().int().positive(),
  cuisines: z.array(z.object({ id: z.string().min(1), brief: z.string().min(1) })).min(1),
  dish_types: z.array(z.string().min(1)).min(1),
  proteins: z.array(z.string().min(1)).min(1),
  techniques: z.array(z.string().min(1)).min(1),
  time_bands: z.array(z.string().min(1)).min(1),
});
export type GridConfig = z.infer<typeof GridConfig>;

const oneOf = (values: string[]) => z.enum(values as [string, ...string[]]);

/** The shape the model must answer in. Its enums come from the config, so no value is invented. */
export const proposalSchema = (config: GridConfig) =>
  z.object({
    dishes: z.array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string().min(1)),
        dish_type: oneOf(config.dish_types),
        primary_protein: oneOf(config.proteins),
        technique: oneOf(config.techniques),
        time_band: oneOf(config.time_bands),
      }),
    ),
  });
export type Proposal = z.infer<ReturnType<typeof proposalSchema>>["dishes"][number];

export async function loadGridConfig(path: string) {
  return GridConfig.parse(await Bun.file(path).json());
}

export function proposalPrompt(config: GridConfig, cuisine: GridConfig["cuisines"][number]) {
  return [
    `Cuisine: ${cuisine.id}. ${cuisine.brief}`,
    `Propose ${config.dishes_per_cuisine} dishes.`,
    `dish_type is one of: ${config.dish_types.join(", ")}.`,
    `primary_protein is one of: ${config.proteins.join(", ")}.`,
    `technique is one of: ${config.techniques.join(", ")}.`,
    `time_band is one of: ${config.time_bands.join(", ")}.`,
  ].join("\n");
}
