import { Hono } from "hono";

export const app = new Hono().basePath("/api/v1").get("/healthz", (c) => c.json({ status: "ok" }));

export type AppType = typeof app;
