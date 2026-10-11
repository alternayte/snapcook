import type { LlmCallRecord } from "@snapcook/schema";
import { boolean, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import { timestamptz, usd } from "./columns";

// Partitioned by month on created_at. drizzle-kit cannot express partitioning, so the DDL is a
// hand-written migration and this file stays out of the generator's schema glob.
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid()
      .notNull()
      .$defaultFn(() => Bun.randomUUIDv7()),
    household_id: uuid(),
    endpoint: text().notNull(),
    model: text().notNull(),
    prompt_tokens: integer().notNull(),
    completion_tokens: integer().notNull(),
    cost_usd: usd().notNull(),
    latency_ms: integer().notNull(),
    ok: boolean().notNull(),
    created_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.created_at] })],
);

/** The sink that packages/llm writes every model call to. */
export const recordLlmCall = (db: Db) => async (call: LlmCallRecord) => {
  await db.insert(llmCalls).values(call);
};
