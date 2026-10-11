import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LlmCallRecord } from "@snapcook/schema";
import { z } from "zod";
import { createLlm } from "./llm";

/** Model ids come from the environment, never from literals in code. */
export const LlmEnv = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  MODEL_VISION: z.string().min(1),
  MODEL_ADAPT: z.string().min(1),
  MODEL_REVIEW: z.string().min(1),
  MODEL_EMBED: z.string().min(1),
});
export type LlmEnv = z.infer<typeof LlmEnv>;

export function createOpenRouterLlm(
  env: Record<string, string | undefined>,
  record: (call: LlmCallRecord) => Promise<void>,
) {
  const config = LlmEnv.parse(env);
  const openrouter = createOpenRouter({ apiKey: config.OPENROUTER_API_KEY });
  // Usage accounting makes OpenRouter return the cost of each call.
  const chat = (id: string) => openrouter.chat(id, { usage: { include: true } });
  return createLlm({
    record,
    models: {
      vision: chat(config.MODEL_VISION),
      adapt: chat(config.MODEL_ADAPT),
      review: chat(config.MODEL_REVIEW),
      embed: openrouter.textEmbeddingModel(config.MODEL_EMBED),
    },
  });
}
