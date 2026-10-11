import { Hono } from "hono";
import { cors } from "hono/cors";

// Browser origins allowed to call the API. Native clients send no Origin header.
const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean);

export const app = new Hono()
  .basePath("/api/v1")
  .use(cors({ origin: (origin) => (corsOrigins.includes(origin) ? origin : null) }))
  .get("/healthz", (c) => c.json({ status: "ok" }));

export type AppType = typeof app;
