import type { Db } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import {
  type DeviceProfile,
  DeviceVariantDraft,
  type DishCandidate,
  RecipeDraft,
} from "@snapcook/schema";
import type { PipelineConfig } from "./config";
import { latest, save } from "./store";
import { validateVariant } from "./validate";
import { BASE_SERVINGS } from "./write";

/**
 * Writes the device variant of the current draft. A variant that breaks a device limit gets one
 * retry with the findings; what is left is for the validate stage to report.
 */
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

  const base = [
    `Dish: ${dish.name} (${dish.cuisine}), ${BASE_SERVINGS} servings.`,
    "",
    `Device: ${profile.name}. Capabilities:`,
    JSON.stringify(profile.capabilities),
    "",
    "Generic recipe:",
    JSON.stringify(draft.value),
  ];
  const ask = (extra: string[]) =>
    llm.structured(
      { system: config.device.system, prompt: [...base, ...extra].join("\n") },
      DeviceVariantDraft,
      {
        endpoint: "corpus.device",
        household_id: null,
        role: "write",
      },
    );

  let variant = await ask([]);
  const problems = validateVariant(variant, profile.capabilities);
  if (problems.length > 0) {
    variant = await ask([
      "",
      "Your previous variant:",
      JSON.stringify(variant),
      "",
      "It breaks these limits. Fix every one and return the full corrected variant:",
      ...problems.map((p) => `- ${p.message}`),
    ]);
  }
  await save(db, dish.id, "device", variant, draft.attempt);
  return variant.suitability;
}
