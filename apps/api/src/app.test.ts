import { afterAll, expect, test } from "bun:test";
import { createDb } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import { createTestServer } from "./testing";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

// The container healthcheck and the reverse proxy both depend on this exact path.
test("GET /api/v1/healthz answers 200 when the database answers", async () => {
  const res = await createTestServer(db).server.request("/api/v1/healthz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("GET /api/v1/healthz answers 503 when the database is unreachable", async () => {
  const down = createDb("postgres://nobody:nothing@127.0.0.1:1/none");
  const res = await createTestServer(down.db).server.request("/api/v1/healthz");
  expect(res.status).toBe(503);
  await down.pool.end();
});
