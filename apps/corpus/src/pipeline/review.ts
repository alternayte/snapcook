import type { Db } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import {
  DeviceVariantDraft,
  type DishCandidate,
  RecipeDraft,
  ReviewVerdict,
  ValidationReport,
} from "@snapcook/schema";
import type { PipelineConfig } from "./config";
import { latest, save } from "./store";
import { BASE_SERVINGS } from "./write";

/** Has the second model family judge the current draft, once it has passed validation. */
export async function review(db: Db, llm: Llm, config: PipelineConfig, dish: DishCandidate) {
  const draft = await latest(db, dish.id, "write", RecipeDraft);
  if (!draft) return "blocked: no draft";
  const report = await latest(db, dish.id, "validate", ValidationReport);
  if (report?.attempt !== draft.attempt) return "blocked: not validated";
  if (report.value.problems.length > 0) return "blocked: validation problems";
  const existing = await latest(db, dish.id, "review", ReviewVerdict);
  if (existing?.attempt === draft.attempt) return "skipped";
  const variant = await latest(db, dish.id, "device", DeviceVariantDraft);

  const verdict = await llm.structured(
    {
      system: config.review.system,
      prompt: [
        `Dish: ${dish.name} (${dish.cuisine}), ${BASE_SERVINGS} servings.`,
        `Classification: ${dish.dish_type}, ${dish.primary_protein}, ${dish.technique}, ${dish.time_band}`,
        "",
        "Recipe:",
        JSON.stringify(draft.value),
        "",
        "Device variant:",
        JSON.stringify(variant?.attempt === draft.attempt ? variant.value : null),
      ].join("\n"),
    },
    ReviewVerdict,
    { endpoint: "corpus.review", household_id: null, role: "review" },
  );
  await save(db, dish.id, "review", verdict, draft.attempt);
  return verdict.verdict;
}
