import type { Db } from "@snapcook/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";

export type AppDeps = {
  db: Db;
  /** Browser origins allowed to call the API. Native clients send no Origin header. */
  corsOrigins: string[];
};

export function createApp({ db, corsOrigins }: AppDeps) {
  return new Hono()
    .basePath("/api/v1")
    .use(cors({ origin: (origin) => (corsOrigins.includes(origin) ? origin : null) }))
    .get("/healthz", async (c) => {
      try {
        await db.execute(sql`select 1`);
        return c.json({ status: "ok" as const });
      } catch {
        return c.json({ status: "unavailable" as const }, 503);
      }
    });
}

export type AppType = ReturnType<typeof createApp>;
