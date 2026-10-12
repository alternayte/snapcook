import { Hono } from "hono";
import { type AppDeps, createApp } from "./app";
import { createAdmin } from "./modules/admin/routes";

/** The whole HTTP surface: sign-in, the API, and the review pages. */
export function createServer(deps: AppDeps) {
  return new Hono()
    .on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw))
    .route("/", createApp(deps))
    .route("/admin", createAdmin({ db: deps.db, auth: deps.auth }));
}
