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
import { billingWebhook } from "./modules/billing/webhook";
import { cookRoutes } from "./modules/cook/routes";
import { householdRoutes, sessionRoutes } from "./modules/household/routes";
import { membership } from "./modules/household/service";
import { type ImportRouteDeps, importRoutes } from "./modules/imports/routes";
import { listRoutes } from "./modules/list/routes";
import { pantryRoutes } from "./modules/pantry/routes";
import { recipeRoutes } from "./modules/recipes/routes";
import { type SnapDeps, snapRoutes } from "./modules/snaps/routes";
import { suggestionRoutes } from "./modules/suggestions/routes";
import { type CorpusReader, createCorpusReader } from "./modules/suggestions/service";

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
  imports: Omit<ImportRouteDeps, "db">;
  /** The kept copy of every recipe, shared with the jobs that change recipes. */
  corpus?: CorpusReader;
  /** Receives one line per request, for the server's log. Unset means no request log. */
  log?: (line: string) => void;
  /** Says whether the background jobs are running. Unset means there are none to check. */
  jobsHealthy?: () => boolean;
  /** The secret the store service sends with each subscription event. Unset turns the route off. */
  billingWebhookSecret?: string;
  /** The id of the model that adapts recipes, stored with each adaptation. */
  adaptModel: string;
};

// A picture never changes once made: its name is the recipe version it belongs to.
const IMAGE_NAME = /^[0-9a-f-]{36}\.webp$/;

export function createApp(deps: AppDeps) {
  const { db, auth, llm, corsOrigins, imageDir, ownerEmails } = deps;
  const matcher = deps.matcher ?? createIngredientMatcher(db);
  const corpus = deps.corpus ?? createCorpusReader(db);

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

  const signedIn = new Hono<SessionEnv>().use(session).route(
    "/",
    sessionRoutes(db, ownerEmails, {
      householdDirs: [deps.snaps.snapDir, deps.imports.photoDir],
      imageDir,
      onRecipesChanged: corpus.invalidate,
    }),
  );
  const inHousehold = new Hono<HouseholdEnv>()
    .use(session, household)
    .route("/", householdRoutes(db, llm, matcher))
    .route("/", pantryRoutes(db, matcher))
    .route("/", snapRoutes({ db, ...deps.snaps }))
    .route("/", importRoutes({ db, ...deps.imports }))
    .route("/", cookRoutes(db, llm))
    .route("/", listRoutes(db, matcher))
    .route("/", recipeRoutes({ db, llm, model: deps.adaptModel, corpus }))
    .route("/", suggestionRoutes({ db, llm, corpus }));

  return new Hono()
    .basePath("/api/v1")
    .use(
      cors({
        origin: (origin) => (corsOrigins.includes(origin) ? origin : null),
        credentials: true,
      }),
    )
    .use(async (c, next) => {
      const started = Date.now();
      const id = crypto.randomUUID();
      c.header("x-request-id", id);
      await next();
      // The household is known only after the session is read, so it is taken from the context here.
      const household = (c.var as { household?: { id: string } }).household?.id ?? null;
      // The health check runs every few seconds and would bury everything else.
      if (c.req.path.endsWith("/healthz")) return;
      deps.log?.(
        JSON.stringify({
          time: new Date(started).toISOString(),
          id,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Date.now() - started,
          household,
        }),
      );
    })
    .get("/healthz", async (c) => {
      try {
        await db.execute(sql`select 1`);
        if (deps.jobsHealthy && !deps.jobsHealthy()) throw new Error("jobs are down");
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
    .route("/", billingWebhook(db, deps.billingWebhookSecret))
    .route("/", signedIn)
    .route("/", inHousehold);
}

export type AppType = ReturnType<typeof createApp>;
