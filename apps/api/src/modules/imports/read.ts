import { normaliseQuantity } from "@snapcook/recognition";
import { IngredientRole } from "@snapcook/schema";
import { z } from "zod";

/** What the model reads from a household's photos or screenshots of one recipe. */
export const ReadOutput = z.object({
  /** False when the images show no recipe the model can follow. */
  is_recipe: z.boolean(),
  title: z.string(),
  servings: z.number().int().positive(),
  time_total_min: z.number().int().positive(),
  time_active_min: z.number().int().positive(),
  cuisine: z.string(),
  dish_type: z.string(),
  primary_protein: z.string(),
  technique: z.string(),
  ingredients: z.array(
    z.object({
      /** The ingredient as the recipe prints it. */
      text: z.string().min(1),
      /** The plain, generic ingredient, as a shop or a recipe index names it. */
      generic: z.string().min(1),
      quantity: z.number().positive().nullable(),
      /** As printed. Units outside the app's own are converted after the read. */
      unit: z.string().nullable(),
      prep: z.string().nullable(),
      role: IngredientRole,
    }),
  ),
  steps: z.array(
    z.object({
      text: z.string().min(1),
      kind: z.enum(["prep", "pan", "oven", "rest"]),
      lane: z.enum(["main", "side"]),
      minutes: z.number().positive().nullable(),
    }),
  ),
});
export type ReadOutput = z.infer<typeof ReadOutput>;

export type Choices = {
  cuisine: string[];
  dish_type: string[];
  primary_protein: string[];
  technique: string[];
};

const listed = (values: string[]) => values.map((v) => `"${v}"`).join(", ");

/** The instructions for reading one recipe from its images. */
export const readHint = (choices: Choices) =>
  [
    "These images are photos or screenshots of one recipe from a cookbook, a magazine, a website or a handwritten card. A recipe may run across several images: read them in order as one recipe.",
    "Copy what the recipe says. Do not improve it, add ingredients, or change amounts. Where the images cannot be read, leave that part out rather than guess.",
    "If the images do not show a recipe, set is_recipe to false and return empty lists.",
    "title: the recipe's own title. servings: the number it serves; 4 when it does not say. time_total_min and time_active_min: as stated, or your honest estimate from the steps.",
    `cuisine: one of ${listed(choices.cuisine)}.`,
    `dish_type: one of ${listed(choices.dish_type)}.`,
    `primary_protein: one of ${listed(choices.primary_protein)}.`,
    `technique: one of ${listed(choices.technique)}.`,
    "ingredients: one entry per ingredient line. text is the line as printed. generic is the ingredient itself in English, singular, with no brand, size or pack type: 'Mae Ploy red curry paste' is 'red curry paste', '2 x 400g tins chopped tomatoes' is 'tinned chopped tomatoes'.",
    "quantity and unit: the amount as printed. Write the unit as printed (g, kg, ml, l, tbsp, tsp, cup, oz, lb) or 'piece' for things that are counted. Both null for 'to taste' or no amount. prep: how it is cut or prepared, or null.",
    "role: core when the dish is not this dish without it; supporting when it belongs but the dish survives without it; staple for salt, pepper, oil, butter and water-like basics; optional for garnish and anything the recipe calls optional.",
    "steps: the method in order, one entry per step, in the recipe's own order and meaning, in plain English. kind is prep, pan (on the hob), oven or rest. lane is main, or side for a step that runs while a main step cooks. minutes for any step that takes time, else null.",
    "Translate a recipe in another language into British English.",
  ].join("\n");

// Units written out in words, as recipes often print them.
const WORDS: Record<string, string> = {
  gram: "g",
  grams: "g",
  millilitre: "ml",
  millilitres: "ml",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbs: "tbsp",
  tbsps: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsps: "tsp",
  cups: "cup",
  pieces: "piece",
  clove: "piece",
  cloves: "piece",
  slice: "piece",
  slices: "piece",
  tin: "piece",
  tins: "piece",
  can: "piece",
  cans: "piece",
};

/** An amount in the app's units. Kilograms, litres, ounces and pounds are converted. */
export function amountOf(line: ReadOutput["ingredients"][number]) {
  const written = line.unit?.trim().toLowerCase() ?? null;
  const unit = written === null ? null : (WORDS[written] ?? written);
  return normaliseQuantity({
    quantity: line.quantity,
    unit,
    // A printed weight such as "1.5 kg" is converted the way a label's is.
    label_text:
      line.quantity !== null && unit && !/^(g|ml|tbsp|tsp|cup|piece)$/.test(unit)
        ? `${line.quantity} ${unit}`
        : null,
  });
}
