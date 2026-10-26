import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AppDeps, createApp } from "./app";
import { createAdmin } from "./modules/admin/routes";

/** The whole HTTP surface: sign-in, the API, and the review pages. */
export function createServer(deps: AppDeps) {
  const origins = deps.corsOrigins;
  return new Hono()
    .use(
      "/api/auth/*",
      cors({ origin: (origin) => (origins.includes(origin) ? origin : null), credentials: true }),
    )
    .on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw))
    .route("/", createApp(deps))
    .route(
      "/admin",
      createAdmin({ db: deps.db, auth: deps.auth, onRecipesChanged: deps.corpus?.invalidate }),
    );
}
