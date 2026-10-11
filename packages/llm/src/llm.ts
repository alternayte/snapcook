import { EMBEDDING_DIMENSIONS, type LlmCallRecord } from "@snapcook/schema";
import { type EmbeddingModel, embedMany, generateText, type LanguageModel, Output } from "ai";
import type { z } from "zod";

export type CallContext = {
  /** The API route or CLI stage that made the call. */
  endpoint: string;
  household_id: string | null;
};

export type LlmModels = {
  vision: LanguageModel;
  adapt: LanguageModel;
  review: LanguageModel;
  embed: Exclude<EmbeddingModel, string>;
};

export type LlmDeps = {
  models: LlmModels;
  /** Receives one record per model call, including failed ones. */
  record: (call: LlmCallRecord) => Promise<void>;
};

export class LlmCostMissingError extends Error {
  constructor(model: string) {
    super(`the provider reported no cost for a call to ${model}`);
  }
}

type Measured<T> = { value: T; prompt_tokens: number; completion_tokens: number; cost: unknown };

const modelId = (model: LanguageModel | EmbeddingModel) =>
  typeof model === "string" ? model : model.modelId;

const openRouterCost = (metadata: unknown) =>
  (metadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter?.usage
    ?.cost;

export function createLlm({ models, record }: LlmDeps) {
  async function logged<T>(
    model: LanguageModel | EmbeddingModel,
    ctx: CallContext,
    call: () => Promise<Measured<T>>,
  ): Promise<T> {
    const started = Date.now();
    const base = { ...ctx, model: modelId(model) };
    const latency = () => Math.round(Date.now() - started);
    let result: Measured<T>;
    try {
      result = await call();
      if (typeof result.cost !== "number") throw new LlmCostMissingError(base.model);
    } catch (error) {
      await record({
        ...base,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_usd: 0,
        latency_ms: latency(),
        ok: false,
      });
      throw error;
    }
    await record({
      ...base,
      prompt_tokens: result.prompt_tokens,
      completion_tokens: result.completion_tokens,
      cost_usd: result.cost,
      latency_ms: latency(),
      ok: true,
    });
    return result.value;
  }

  async function generate<S extends z.ZodType>(
    model: LanguageModel,
    schema: S,
    ctx: CallContext,
    input: Pick<Parameters<typeof generateText>[0], "prompt" | "messages" | "system">,
  ): Promise<z.infer<S>> {
    return logged(model, ctx, async () => {
      const result = await generateText({
        model,
        output: Output.object({ schema }),
        ...input,
      } as Parameters<typeof generateText>[0]);
      return {
        // The SDK has already validated the output against the schema.
        value: result.output as z.infer<S>,
        prompt_tokens: result.usage.inputTokens ?? 0,
        completion_tokens: result.usage.outputTokens ?? 0,
        cost: openRouterCost(result.providerMetadata),
      };
    });
  }

  return {
    /** Describes one JPEG or PNG image as an object of the given schema. */
    vision<S extends z.ZodType>(
      image: Uint8Array,
      mediaType: "image/jpeg" | "image/png",
      schema: S,
      hint: string,
      ctx: CallContext,
    ) {
      return generate(models.vision, schema, ctx, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: hint },
              { type: "file", data: image, mediaType },
            ],
          },
        ],
      });
    },

    /** Answers a prompt as an object of the given schema. `review` uses the second model family. */
    structured<S extends z.ZodType>(
      prompt: { system?: string; prompt: string },
      schema: S,
      ctx: CallContext & { role?: "adapt" | "review" },
    ) {
      const { role = "adapt", ...context } = ctx;
      return generate(models[role], schema, context, prompt);
    },

    /** Embeds each text as a vector of EMBEDDING_DIMENSIONS numbers, in input order. */
    async embed(texts: string[], ctx: CallContext) {
      // One provider request per logged call: the SDK reports cost for a single request only,
      // so batches are cut here instead of inside the SDK.
      const batchSize = Math.min((await models.embed.maxEmbeddingsPerCall) ?? 64, 64);
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = await logged(models.embed, ctx, async () => {
          const result = await embedMany({
            model: models.embed,
            values: texts.slice(i, i + batchSize),
            dimensions: EMBEDDING_DIMENSIONS,
          });
          const wrong = result.embeddings.find((e) => e.length !== EMBEDDING_DIMENSIONS);
          if (wrong) {
            throw new Error(
              `embedding has ${wrong.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
            );
          }
          return {
            value: result.embeddings,
            prompt_tokens: result.usage.tokens,
            completion_tokens: 0,
            cost: openRouterCost(result.providerMetadata),
          };
        });
        vectors.push(...batch);
      }
      return vectors;
    },
  };
}

export type Llm = ReturnType<typeof createLlm>;
