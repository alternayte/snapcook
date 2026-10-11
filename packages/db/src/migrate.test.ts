import { afterAll, expect, test } from "bun:test";
import { createDb, schema } from "./client";
import { migrate } from "./migrate";
import { createEmptyTestDatabase } from "./testing";

const { pool, db } = createDb(await createEmptyTestDatabase());
afterAll(() => pool.end());

test("two processes that start together both finish migrating an empty database", async () => {
  await Promise.all([migrate(pool), migrate(pool)]);

  const tables = await pool.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
  );
  // 22 plain tables, the partitioned llm_calls parent, and two monthly partitions.
  expect(tables.rows[0].n).toBe(25);
});

test("an llm_calls row lands in the partition for its month, and next month's exists", async () => {
  const now = new Date(Date.UTC(2031, 11, 15));
  await migrate(pool, now);
  await pool.query(
    "insert into llm_calls (id, endpoint, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, ok, created_at) values ($1, 'smoke', 'm', 1, 1, 0.000123, 5, true, $2)",
    [Bun.randomUUIDv7(), now],
  );
  const december = await pool.query("select cost_usd from llm_calls_2031_12");
  expect(december.rows).toEqual([{ cost_usd: "0.000123" }]);
  const january = await pool.query("select to_regclass('llm_calls_2032_01') as t");
  expect(january.rows[0].t).toBe("llm_calls_2032_01");
});

test("a value outside a zod enum is rejected by the database", async () => {
  const insert = pool.query(
    "insert into ingredients (id, name, category, default_unit) values ($1, 'x', 'not_a_category', 'g')",
    [Bun.randomUUIDv7()],
  );
  await expect(insert).rejects.toThrow(/ingredients_category_check/);
});

test("nearest-neighbour search over 1024-dimension embeddings returns the closest row", async () => {
  const axis = (i: number) => Array.from({ length: 1024 }, (_, j) => (j === i ? 1 : 0));
  await db.insert(schema.ingredients).values([
    { name: "a", category: "vegetable", default_unit: "piece", embedding: axis(0) },
    { name: "b", category: "vegetable", default_unit: "piece", embedding: axis(1) },
  ]);
  const nearest = await pool.query(
    "select name from ingredients order by embedding <=> $1::vector limit 1",
    [JSON.stringify(axis(1))],
  );
  expect(nearest.rows).toEqual([{ name: "b" }]);
});
