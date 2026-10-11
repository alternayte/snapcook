import { expect, test } from "bun:test";
import { app } from "./app";

// The compose healthcheck and the reverse proxy both depend on this exact path.
test("GET /api/v1/healthz answers 200", async () => {
  const res = await app.request("/api/v1/healthz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});
