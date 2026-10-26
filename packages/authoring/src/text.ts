import type { RecipeDraft } from "@snapcook/schema";

const LETTERS: Record<string, string> = {
  ı: "i",
  ø: "o",
  ß: "ss",
  đ: "d",
  ł: "l",
  æ: "ae",
  œ: "oe",
};

export function slugify(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[ıøßđłæœ]/g, (c) => LETTERS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error(`cannot make a slug from "${name}"`);
  return slug;
}

/** The text a recipe is embedded as: what goes in it, how it is cooked, where it is from, how long. */
export function profileText(
  draft: Pick<RecipeDraft, "ingredients" | "time_total_min">,
  dish: { technique: string; cuisine: string },
) {
  const names = draft.ingredients
    .filter((i) => i.role === "core" || i.role === "supporting")
    .map((i) => i.ingredient);
  return `${names.join(", ")}; ${dish.technique}; ${dish.cuisine.replaceAll("_", " ")}; ${draft.time_total_min} min`;
}
