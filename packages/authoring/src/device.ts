import type { CallContext, Llm } from "@snapcook/llm";
import { type DeviceProfile, DeviceVariantDraft, type RecipeDraft } from "@snapcook/schema";
import { validateVariant } from "./validate";

export type VariantInput = {
  /** The dish, as the prompt names it, for example "Dal Tadka (indian)". */
  dish: string;
  servings: number;
  recipe: RecipeDraft;
  profile: DeviceProfile;
};

/**
 * Writes the device variant of a generic recipe. A variant that breaks a device limit gets one
 * retry with the findings; what is left is for the caller's validation to report.
 */
export async function writeVariant(
  llm: Llm,
  system: string,
  input: VariantInput,
  ctx: CallContext & { role: "adapt" | "write" },
) {
  const base = [
    `Dish: ${input.dish}, ${input.servings} servings.`,
    "",
    `Device: ${input.profile.name}. Capabilities:`,
    JSON.stringify(input.profile.capabilities),
    "",
    "Generic recipe:",
    JSON.stringify(input.recipe),
  ];
  const ask = (extra: string[]) =>
    llm.structured({ system, prompt: [...base, ...extra].join("\n") }, DeviceVariantDraft, ctx);

  const variant = await ask([]);
  const problems = validateVariant(variant, input.profile.capabilities);
  if (problems.length === 0) return variant;
  return ask([
    "",
    "Your previous variant:",
    JSON.stringify(variant),
    "",
    "It breaks these limits. Fix every one and return the full corrected variant:",
    ...problems.map((p) => `- ${p.message}`),
  ]);
}
