import { join } from "node:path";
import type { Db } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import { createIngredientMatcher, type IngredientMatcher } from "@snapcook/recognition";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { fail, type HouseholdEnv, type SessionEnv } from "./http";
import type { Auth } from "./modules/auth/auth";
import { householdRoutes, sessionRoutes } from "./modules/household/routes";
import { membership } from "./modules/household/service";
import { pantryRoutes } from "./modules/pantry/routes";
import { type SnapDeps, snapRoutes } from "./modules/snaps/routes";
import { suggestionRoutes } from "./modules/suggestions/routes";
import { createCorpusReader } from "./modules/suggestions/service";

export type AppDeps = {
  db: Db;
  auth: Auth;
  llm: Llm;
  /** Browser origins allowed to call the API. Native clients send no Origin header. */
  /** Shared with the detection job when one runs. */
  matcher?: IngredientMatcher;
  corsOrigins: string[];
  /** Directory that holds the recipe pictures. With none, no picture is served. */
  imageDir?: string;
  /** A household created by one of these addresses gets the owner plan. Lower case. */
  ownerEmails: string[];
  snaps: Omit<SnapDeps, "db">;
};

// A picture never changes once made: its name is the recipe version it belongs to.
const IMAGE_NAME = /^[0-9a-f-]{36}\.webp$/;

export function createApp(deps: AppDeps) {
  const { db, auth, llm, corsOrigins, imageDir, ownerEmails } = deps;
  const matcher = deps.matcher ?? createIngredientMatcher(db);

  const session = createMiddleware<SessionEnv>(async (c, next) => {
    const found = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!found) return fail(c, 401, "unauthenticated", "Sign in first.");
    const { id, name, email } = found.user;
    c.set("user", { id, name, email });
    return next();
  });

  // The household comes from the session's user and from nowhere else: no route takes its id.
  const household = createMiddleware<HouseholdEnv>(async (c, next) => {
    const member = await membership(db, c.var.user.id);
    if (!member) {
      return fail(c, 403, "forbidden", "Create or join a household first.", {
        reason: "no_household",
      });
    }
    c.set("household", member.household);
    c.set("role", member.role);
    return next();
  });

  const signedIn = new Hono<SessionEnv>().use(session).route("/", sessionRoutes(db, ownerEmails));
  const inHousehold = new Hono<HouseholdEnv>()
    .use(session, household)
    .route("/", householdRoutes(db, llm, matcher))
    .route("/", pantryRoutes(db, matcher))
    .route("/", snapRoutes({ db, ...deps.snaps }))
    .route("/", suggestionRoutes({ db, llm, corpus: createCorpusReader(db) }));

  return new Hono()
    .basePath("/api/v1")
    .use(
      cors({
        origin: (origin) => (corsOrigins.includes(origin) ? origin : null),
        credentials: true,
      }),
    )
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
    })
    .route("/", signedIn)
    .route("/", inHousehold);
}

export type AppType = ReturnType<typeof createApp>;
