import { type PipelineConfig, writeVariant } from "@snapcook/authoring";
import type { Db } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import {
  type DeviceProfile,
  DeviceVariantDraft,
  type DishCandidate,
  RecipeDraft,
} from "@snapcook/schema";
import { latest, save } from "./store";
import { BASE_SERVINGS } from "./write";

/** Writes the device variant of the current draft, once per draft. */
export async function device(
  db: Db,
  llm: Llm,
  config: PipelineConfig,
  dish: DishCandidate,
  profile: DeviceProfile,
) {
  const draft = await latest(db, dish.id, "write", RecipeDraft);
  if (!draft) return "blocked: no draft";
  const existing = await latest(db, dish.id, "device", DeviceVariantDraft);
  if (existing?.attempt === draft.attempt) return "skipped";

  const variant = await writeVariant(
    llm,
    config.device.system,
    {
      dish: `${dish.name} (${dish.cuisine})`,
      servings: BASE_SERVINGS,
      recipe: draft.value,
      profile,
    },
    { endpoint: "corpus.device", household_id: null, role: "write" },
  );
  await save(db, dish.id, "device", variant, draft.attempt);
  return variant.suitability;
}
