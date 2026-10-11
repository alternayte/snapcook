import { Hono } from "hono";
import { type AppDeps, createApp } from "./app";
import { createAdmin } from "./modules/admin/routes";

/** The whole HTTP surface: the API, plus the review pages when a password is configured. */
export function createServer(deps: AppDeps & { adminPassword?: string }) {
  const server = new Hono().route("/", createApp(deps));
  if (deps.adminPassword) {
    server.route("/admin", createAdmin({ db: deps.db, password: deps.adminPassword }));
  }
  return server;
}
