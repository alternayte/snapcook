import { createDb, migrate, recordLlmCall, schema } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

// A 32x32 solid red PNG.
const RED_SQUARE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mO4oKBAU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAE7YQD2B7wk2AAAAAElFTkSuQmCC",
  "base64",
);

/** Makes one live call per model role and prints the rows they logged. */
export async function smoke() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(databaseUrl);
  await migrate(pool);
  const llm = createOpenRouterLlm(process.env, recordLlmCall(db));
  const ctx = { endpoint: "smoke", household_id: null };

  const seen = await llm.vision(
    new Uint8Array(RED_SQUARE),
    "image/png",
    z.object({ dominant_colour: z.string() }),
    "Name the dominant colour of this image in one word.",
    ctx,
  );
  const sum = z.object({ answer: z.number() });
  const adapt = await llm.structured({ prompt: "What is 2 + 3?" }, sum, ctx);
  const review = await llm.structured({ prompt: "What is 2 + 3?" }, sum, {
    ...ctx,
    role: "review",
  });
  const write = await llm.structured({ prompt: "What is 2 + 3?" }, sum, { ...ctx, role: "write" });
  const [vector] = await llm.embed(["chicken thigh, bell pepper, onion"], ctx);

  console.log({ seen, adapt, review, write, dimensions: vector?.length });
  const rows = await db
    .select()
    .from(schema.llmCalls)
    .where(eq(schema.llmCalls.endpoint, "smoke"))
    .orderBy(desc(schema.llmCalls.created_at))
    .limit(5);
  console.table(
    rows.map(({ model, prompt_tokens, completion_tokens, cost_usd, latency_ms, ok }) => ({
      model,
      prompt_tokens,
      completion_tokens,
      cost_usd,
      latency_ms,
      ok,
    })),
  );
  await pool.end();
}
