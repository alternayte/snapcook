import type { CallContext, Llm } from "@snapcook/llm";
import { type Location, type SnapProposal, Unit } from "@snapcook/schema";
import { z } from "zod";
import type { IngredientMatcher } from "./matcher";

/** What the vision model reports for one photo. It names things; it never chooses an ingredient id. */
export const DetectionOutput = z.object({
  items: z.array(
    z.object({
      /** The thing as it appears, in a few words. */
      name: z.string().min(1),
      /** The plain cooking ingredient this most likely is. */
      canonical_guess: z.string().min(1),
      quantity: z.number().positive().nullable(),
      unit: Unit.nullable(),
      /** How sure the count or amount is, from 0 to 1. Null when no amount is given. */
      count_confidence: z.number().min(0).max(1).nullable(),
      is_packaged: z.boolean(),
      /** Text read from a label, word for word. */
      label_text: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type DetectedItem = z.infer<typeof DetectionOutput>["items"][number];

const PLACES: Record<Location, string> = {
  fridge: "inside a fridge",
  freezer: "inside a freezer",
  pantry: "in a kitchen cupboard or pantry",
  counter: "on a kitchen counter",
};

export const detectionHint = (location: Location) =>
  [
    `This photo was taken ${PLACES[location]}. List every food item you can see.`,
    "Report only what is visible. Do not infer what a closed or opaque container holds:",
    'report it with name "container" and canonical_guess "container", and give label_text if a label is readable.',
    'name: the item as it appears, in a few words. canonical_guess: the plain ingredient name a recipe would use, singular, in English (for example "chicken thigh", "bell pepper", "whole milk").',
    'quantity and unit: only when you can count the items or read an amount. Count separate pieces with unit "piece". Use g or ml for an amount read from a label. Otherwise both are null.',
    "count_confidence: how sure the amount is, 0 to 1; null when there is no amount.",
    "is_packaged: true for anything in its shop packaging. label_text: the words and weight on the label, exactly as printed, or null.",
    "confidence: how sure you are of what the item is, 0 to 1.",
    "List one entry per distinct item. Do not list shelves, crockery, appliances or anything that is not food or drink.",
    "A photo with no food returns an empty list.",
  ].join("\n");

// An amount printed on a label, such as "450 g", "1,5 kg", "500ml" or "1 L".
const PACK_SIZE = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i;
const PACK_UNITS: Record<string, ["g" | "ml", number]> = {
  kg: ["g", 1000],
  g: ["g", 1],
  ml: ["ml", 1],
  cl: ["ml", 10],
  l: ["ml", 1000],
};

/**
 * The amount to propose for an item. A pack size read from the label wins over what the model
 * estimated by eye. An amount with no unit is a count.
 */
export function normaliseQuantity(
  item: Pick<DetectedItem, "quantity" | "unit" | "label_text">,
): Pick<SnapProposal, "quantity" | "unit"> {
  const printed = item.label_text ? PACK_SIZE.exec(item.label_text) : null;
  if (printed) {
    const [unit, factor] = PACK_UNITS[(printed[2] ?? "").toLowerCase()] ?? ["g", 1];
    const packs = item.unit === "piece" && item.quantity ? item.quantity : 1;
    const amount = Number((printed[1] ?? "").replace(",", ".")) * factor * packs;
    return { quantity: Math.round(amount * 100) / 100, unit };
  }
  if (item.quantity === null) return { quantity: null, unit: null };
  return { quantity: Math.round(item.quantity * 100) / 100, unit: item.unit ?? "piece" };
}

/** Sends one photo to the vision model and returns what it saw. */
export function detect(
  llm: Llm,
  image: Uint8Array,
  mediaType: "image/jpeg" | "image/png",
  location: Location,
  ctx: CallContext,
) {
  return llm.vision(image, mediaType, DetectionOutput, detectionHint(location), ctx);
}

/**
 * Turns detected items into proposals: each is matched to a canonical ingredient by its guessed
 * name, then by its visible name, then by meaning. An item that matches nothing stays free text.
 */
export async function toProposals(
  items: DetectedItem[],
  matcher: IngredientMatcher,
  llm: Llm,
  ctx: CallContext,
): Promise<Omit<SnapProposal, "existing_item_id">[]> {
  const exact = await Promise.all(
    items.map(async (item) =>
      item.canonical_guess.toLowerCase() === "container"
        ? undefined
        : ((await matcher.match(item.canonical_guess)) ?? (await matcher.match(item.name))),
    ),
  );
  const unmatched = items
    .map((item, i) => ({ item, i }))
    .filter(({ item, i }) => !exact[i] && item.canonical_guess.toLowerCase() !== "container");
  const near = await matcher.nearest(
    unmatched.map(({ item }) => item.canonical_guess),
    llm,
    ctx,
  );
  const byMeaning = new Map(unmatched.map(({ i }, n) => [i, near[n]]));

  return items.map((item, i) => {
    const hit = exact[i] ?? byMeaning.get(i);
    return {
      name: item.name,
      ingredient_id: hit?.id ?? null,
      ...normaliseQuantity(item),
      count_confidence: item.quantity === null ? null : item.count_confidence,
      is_packaged: item.is_packaged,
      label_text: item.label_text,
      confidence: item.confidence,
    };
  });
}
