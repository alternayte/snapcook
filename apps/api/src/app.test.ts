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

test("GET /api/v1/healthz answers 503 when the background jobs are down", async () => {
  const lines: string[] = [];
  const { createApp } = await import("./app");
  const { createAuth } = await import("./modules/auth/auth");
  const app = createApp({
    db,
    auth: createAuth(db, {
      secret: "x".repeat(32),
      baseUrl: "http://localhost",
      trustedOrigins: [],
    }),
    llm: {} as never,
    corsOrigins: [],
    ownerEmails: [],
    snaps: { snapDir: "/nonexistent", enqueueDetect: async () => {} },
    adaptModel: "m",
    jobsHealthy: () => false,
    log: (line) => lines.push(line),
  });
  expect((await app.request("/api/v1/healthz")).status).toBe(503);
  // Each request leaves one line with its route, status and time.
  expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
    method: "GET",
    route: "/api/v1/healthz",
    status: 503,
  });
});
