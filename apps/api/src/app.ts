import { join } from "node:path";
import type { Db } from "@snapcook/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";

export type AppDeps = {
  db: Db;
  /** Browser origins allowed to call the API. Native clients send no Origin header. */
  corsOrigins: string[];
  /** Directory that holds the recipe pictures. With none, no picture is served. */
  imageDir?: string;
};

// A picture never changes once made: its name is the recipe version it belongs to.
const IMAGE_NAME = /^[0-9a-f-]{36}\.webp$/;

export function createApp({ db, corsOrigins, imageDir }: AppDeps) {
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
    })
    .get("/images/:name", async (c) => {
      const name = c.req.param("name");
      if (!imageDir || !IMAGE_NAME.test(name)) return c.notFound();
      const file = Bun.file(join(imageDir, name));
      if (!(await file.exists())) return c.notFound();
      return c.body(await file.arrayBuffer(), 200, {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
      });
    });
}

export type AppType = ReturnType<typeof createApp>;
