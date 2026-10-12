import { EMBEDDING_DIMENSIONS, type LlmCallRecord } from "@snapcook/schema";
import { type EmbeddingModel, embedMany, generateText, type LanguageModel } from "ai";
import type { z } from "zod";
import type { StructuredBackend, StructuredInput } from "./backends";

export type CallContext = {
  /** The API route or CLI stage that made the call. */
  endpoint: string;
  household_id: string | null;
  /** Receives the cost of each successful call made under this context, in US dollars. */
  onCost?: (usd: number) => void;
};

export type LlmModels = {
  vision: StructuredBackend;
  adapt: StructuredBackend;
  review: StructuredBackend;
  /** Writes corpus content offline. */
  write: StructuredBackend;
  embed: Exclude<EmbeddingModel, string>;
  /** Draws pictures. Absent where no image model is configured. */
  image?: Exclude<LanguageModel, string>;
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

const openRouterCost = (metadata: unknown) =>
  (metadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter?.usage
    ?.cost;

const IMAGE_TIMEOUT_MS = 5 * 60 * 1000;

export function createLlm({ models, record }: LlmDeps) {
  async function logged<T>(
    model: string,
    ctx: CallContext,
    call: () => Promise<Measured<T>>,
  ): Promise<T> {
    const started = Date.now();
    const base = { endpoint: ctx.endpoint, household_id: ctx.household_id, model };
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
    ctx.onCost?.(result.cost);
    return result.value;
  }

  function generate<S extends z.ZodType>(
    backend: StructuredBackend,
    schema: S,
    ctx: CallContext,
    input: StructuredInput,
  ): Promise<z.infer<S>> {
    return logged(backend.model, ctx, async () => {
      const result = await backend.generate(input, schema);
      // Every backend's output is checked here, whatever the backend itself validates.
      return { ...result, value: schema.parse(result.object) };
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
      prompt: { system?: string; prompt: string; web?: boolean },
      schema: S,
      ctx: CallContext & { role?: "adapt" | "review" | "write" },
    ) {
      const { role = "adapt", ...context } = ctx;
      return generate(models[role], schema, context, prompt);
    },

    /** Draws one picture from a prompt. */
    image(prompt: string, ctx: CallContext) {
      const model = models.image;
      if (!model) throw new Error("no image model is configured");
      return logged(model.modelId, ctx, async () => {
        const result = await generateText({ model, prompt, timeout: IMAGE_TIMEOUT_MS });
        const file = result.files.find((f) => f.mediaType.startsWith("image/"));
        if (!file) throw new Error(`${model.modelId} returned no image`);
        return {
          value: { data: file.uint8Array, mediaType: file.mediaType },
          prompt_tokens: result.usage.inputTokens ?? 0,
          completion_tokens: result.usage.outputTokens ?? 0,
          cost: openRouterCost(result.providerMetadata),
        };
      });
    },

    /** Embeds each text as a vector of EMBEDDING_DIMENSIONS numbers, in input order. */
    async embed(texts: string[], ctx: CallContext) {
      // One provider request per logged call: the SDK reports cost for a single request only,
      // so batches are cut here instead of inside the SDK.
      const batchSize = Math.min((await models.embed.maxEmbeddingsPerCall) ?? 64, 64);
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = await logged(models.embed.modelId, ctx, async () => {
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
