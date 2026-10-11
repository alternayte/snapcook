import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { llmCalls } from "./llm-calls";
import * as corpus from "./tables/corpus";
import * as household from "./tables/household";

export const schema = { ...household, ...corpus, llmCalls };

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { pool, db: drizzle(pool, { schema }) };
}

export type Db = ReturnType<typeof createDb>["db"];
