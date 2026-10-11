import { afterAll, expect, test } from "bun:test";
import { createDb } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import { createApp } from "./app";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

// The container healthcheck and the reverse proxy both depend on this exact path.
test("GET /api/v1/healthz answers 200 when the database answers", async () => {
  const res = await createApp({ db, corsOrigins: [] }).request("/api/v1/healthz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("GET /api/v1/healthz answers 503 when the database is unreachable", async () => {
  const down = createDb("postgres://nobody:nothing@127.0.0.1:1/none");
  const res = await createApp({ db: down.db, corsOrigins: [] }).request("/api/v1/healthz");
  expect(res.status).toBe(503);
  await down.pool.end();
});
