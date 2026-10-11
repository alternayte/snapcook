import { Client } from "pg";
import { createDb } from "./client";
import { migrate } from "./migrate";

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:54330/postgres";

/** Creates an empty, uniquely named database on the test server. `just test-db` starts the server. */
export async function createEmptyTestDatabase() {
  const name = `test_${Bun.randomUUIDv7().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

/** A migrated database of its own for one test file. */
export async function createTestDb() {
  const handle = createDb(await createEmptyTestDatabase());
  await migrate(handle.pool);
  return handle;
}
