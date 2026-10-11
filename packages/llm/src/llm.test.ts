import { expect, test } from "bun:test";
import type { LlmCallRecord } from "@snapcook/schema";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createLlm, LlmCostMissingError } from "./llm";

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
};

const answering = (text: string, cost?: number) =>
  new MockLanguageModelV4({
    modelId: "test/chat",
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
      providerMetadata: cost === undefined ? undefined : { openrouter: { usage: { cost } } },
    },
  });

const embedding = (dimensions: number) =>
  new MockEmbeddingModelV4({
    modelId: "test/embed",
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => Array.from({ length: dimensions }, () => 0.5)),
      usage: { tokens: 9 },
      providerMetadata: { openrouter: { usage: { cost: 0.000001 } } },
      warnings: [],
    }),
  });

function setup(chat: MockLanguageModelV4, embed = embedding(1024)) {
  const calls: LlmCallRecord[] = [];
  const llm = createLlm({
    models: { vision: chat, adapt: chat, review: chat, embed },
    record: async (call) => {
      calls.push(call);
    },
  });
  return { llm, calls };
}

const ctx = { endpoint: "test", household_id: null };
const Sum = z.object({ answer: z.number() });

test("a successful call returns the parsed object and logs tokens and cost", async () => {
  const { llm, calls } = setup(answering('{"answer":5}', 0.0042));
  expect(await llm.structured({ prompt: "2 + 3?" }, Sum, ctx)).toEqual({ answer: 5 });
  expect(calls).toEqual([
    {
      endpoint: "test",
      household_id: null,
      model: "test/chat",
      prompt_tokens: 12,
      completion_tokens: 7,
      cost_usd: 0.0042,
      latency_ms: expect.any(Number),
      ok: true,
    },
  ]);
});

test("output that does not match the schema fails the call and is logged as failed", async () => {
  const { llm, calls } = setup(answering('{"answer":"five"}', 0.0042));
  await expect(llm.structured({ prompt: "2 + 3?" }, Sum, ctx)).rejects.toThrow();
  expect(calls.map((c) => c.ok)).toEqual([false]);
});

test("a call with no cost from the provider fails and is logged as failed", async () => {
  const { llm, calls } = setup(answering('{"answer":5}'));
  await expect(llm.structured({ prompt: "2 + 3?" }, Sum, ctx)).rejects.toThrow(LlmCostMissingError);
  expect(calls.map((c) => c.ok)).toEqual([false]);
});

test("an embedding of the wrong size is rejected", async () => {
  const { llm, calls } = setup(answering("{}", 0), embedding(768));
  await expect(llm.embed(["a"], ctx)).rejects.toThrow(/768 dimensions/);
  expect(calls.map((c) => c.ok)).toEqual([false]);
});

test("each embedding request is logged with its own tokens and cost", async () => {
  // The mock model accepts one text per request, so two texts are two requests.
  const { llm, calls } = setup(answering("{}", 0));
  const vectors = await llm.embed(["a", "b"], ctx);
  expect(vectors.map((v) => v.length)).toEqual([1024, 1024]);
  expect(calls).toMatchObject([
    { model: "test/embed", prompt_tokens: 9, cost_usd: 0.000001, ok: true },
    { model: "test/embed", prompt_tokens: 9, cost_usd: 0.000001, ok: true },
  ]);
});
