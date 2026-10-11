import { type Db, schema } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import {
  type DishCandidate,
  RecipeDraft,
  ResearchNotes,
  ReviewVerdict,
  ValidationReport,
} from "@snapcook/schema";
import { asc } from "drizzle-orm";
import type { PipelineConfig } from "./config";
import { latest, save } from "./store";

export const BASE_SERVINGS = 4;

/** The canonical ingredient names, grouped by category, as the writer sees them. */
export async function ingredientList(db: Db) {
  const rows = await db
    .select({ name: schema.ingredients.name, category: schema.ingredients.category })
    .from(schema.ingredients)
    .orderBy(asc(schema.ingredients.category), asc(schema.ingredients.name));
  const groups = new Map<string, string[]>();
  for (const row of rows) groups.set(row.category, [...(groups.get(row.category) ?? []), row.name]);
  return [...groups].map(([category, names]) => `${category}: ${names.join(", ")}`).join("\n");
}

/**
 * Writes the recipe from the research notes. With no draft yet it writes the first one. With a
 * draft that failed validation or review, it rewrites once per call from those findings.
 */
export async function write(
  db: Db,
  llm: Llm,
  config: PipelineConfig,
  dish: DishCandidate,
  ingredients: string,
) {
  const notes = await latest(db, dish.id, "research", ResearchNotes);
  if (!notes) return "blocked: no research";
  const draft = await latest(db, dish.id, "write", RecipeDraft);
  const validation = await latest(db, dish.id, "validate", ValidationReport);
  const review = await latest(db, dish.id, "review", ReviewVerdict);

  const findings: string[] = [];
  if (draft) {
    // A finding counts only when it was made on the current draft.
    if (validation && validation.attempt === draft.attempt) {
      findings.push(...validation.value.problems.map((p) => p.message));
    }
    if (review && review.attempt === draft.attempt && review.value.verdict === "fix") {
      findings.push(...review.value.fixes);
    }
    if (findings.length === 0) return "skipped";
  }

  const prompt = [
    `Dish: ${dish.name} (${dish.cuisine})`,
    `Classification: ${dish.dish_type}, ${dish.primary_protein}, ${dish.technique}, ${dish.time_band}`,
    `Write for ${BASE_SERVINGS} servings.`,
    `Allowed tags: ${config.tags.join(", ")}`,
    "",
    "Research notes:",
    JSON.stringify(notes.value),
    "",
    "Canonical ingredients (use these names exactly):",
    ingredients,
  ];
  if (draft) {
    prompt.push(
      "",
      "Your previous draft:",
      JSON.stringify(draft.value),
      "",
      "Fix every one of these findings and return the full corrected recipe:",
      ...findings.map((f) => `- ${f}`),
    );
  }
  const next = await llm.structured(
    { system: config.write.system, prompt: prompt.join("\n") },
    RecipeDraft,
    { endpoint: "corpus.write", household_id: null, role: "write" },
  );
  await save(db, dish.id, "write", next);
  return draft ? "rewritten" : "done";
}
