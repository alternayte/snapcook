import { type Db, schema } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import {
  type DeviceProfile,
  DeviceVariantDraft,
  type DishCandidate,
  RecipeDraft,
  ReviewVerdict,
  ValidationReport,
} from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { GridConfig } from "../grid/config";
import type { PipelineConfig } from "./config";
import { latest, save } from "./store";
import { BASE_SERVINGS } from "./write";

/**
 * The verdict plus the reviewer's corrections to how the dish is filed. Null means the filing is
 * right. The writer cannot change the filing, so a correction is applied here, not sent as a fix.
 */
const reviewAnswer = (grid: GridConfig) =>
  ReviewVerdict.extend({
    cuisine: z.enum(grid.cuisines.map((c) => c.id) as [string, ...string[]]).nullable(),
    primary_protein: z.enum(grid.proteins as [string, ...string[]]).nullable(),
  });

/** Has the second model family judge the current draft, once it has passed validation. */
export async function review(
  db: Db,
  llm: Llm,
  config: PipelineConfig,
  grid: GridConfig,
  profile: DeviceProfile,
  dish: DishCandidate,
) {
  const draft = await latest(db, dish.id, "write", RecipeDraft);
  if (!draft) return "blocked: no draft";
  const report = await latest(db, dish.id, "validate", ValidationReport);
  if (report?.attempt !== draft.attempt) return "blocked: not validated";
  if (report.value.problems.length > 0) return "blocked: validation problems";
  const existing = await latest(db, dish.id, "review", ReviewVerdict);
  if (existing?.attempt === draft.attempt) return "skipped";
  const variant = await latest(db, dish.id, "device", DeviceVariantDraft);

  const answer = await llm.structured(
    {
      system: config.review.system,
      prompt: [
        `Dish: ${dish.name}, ${BASE_SERVINGS} servings.`,
        `Filed under cuisine group: ${dish.cuisine}; primary protein: ${dish.primary_protein}; type: ${dish.dish_type}; technique: ${dish.technique}.`,
        "Cuisine groups:",
        ...grid.cuisines.map((c) => `- ${c.id}: ${c.brief}`),
        `Primary proteins: ${grid.proteins.join(", ")}`,
        "",
        "Recipe:",
        JSON.stringify(draft.value),
        "",
        `Device: ${profile.name}. Capabilities:`,
        JSON.stringify(profile.capabilities),
        "Device variant:",
        JSON.stringify(variant?.attempt === draft.attempt ? variant.value : null),
      ].join("\n"),
    },
    reviewAnswer(grid),
    { endpoint: "corpus.review", household_id: null, role: "review" },
  );
  await save(db, dish.id, "review", answer, draft.attempt);
  const refiled = {
    ...(answer.cuisine && answer.cuisine !== dish.cuisine ? { cuisine: answer.cuisine } : {}),
    ...(answer.primary_protein && answer.primary_protein !== dish.primary_protein
      ? { primary_protein: answer.primary_protein }
      : {}),
  };
  if (Object.keys(refiled).length === 0) return answer.verdict;
  await db.update(schema.dishCandidates).set(refiled).where(eq(schema.dishCandidates.id, dish.id));
  return `${answer.verdict} (refiled: ${Object.values(refiled).join(", ")})`;
}
