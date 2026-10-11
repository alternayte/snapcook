import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";

const MIGRATIONS_FOLDER = new URL("../drizzle", import.meta.url).pathname;

// Any fixed number works: it names this application's migration lock in Postgres.
const MIGRATION_LOCK_KEY = 4_815_162_342;

const monthStart = (date: Date, offset: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));

const day = (date: Date) => date.toISOString().slice(0, 10);

/** Creates the monthly `llm_calls` partitions for the month of `now` and the month after. */
export async function ensureLlmCallPartitions(client: Pool | PoolClient, now: Date) {
  for (const offset of [0, 1]) {
    const from = monthStart(now, offset);
    const to = monthStart(now, offset + 1);
    const name = `llm_calls_${from.getUTCFullYear()}_${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "llm_calls" FOR VALUES FROM ('${day(from)}') TO ('${day(to)}')`,
    );
  }
}

/** Applies pending migrations. Safe when several processes start at once. */
export async function migrate(pool: Pool, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await runMigrations(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    await ensureLlmCallPartitions(client, now);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
