import { createDb, migrate, recordLlmCall } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import { createAuth } from "./modules/auth/auth";
import { createServer } from "./server";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const list = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const { db, pool } = createDb(required("DATABASE_URL"));
await migrate(pool);

const { APPLE_CLIENT_ID, APPLE_CLIENT_SECRET, APPLE_BUNDLE_ID, GOOGLE_CLIENT_ID } = process.env;
const { GOOGLE_CLIENT_SECRET } = process.env;
const corsOrigins = list("CORS_ORIGINS");

const app = createServer({
  db,
  llm: createOpenRouterLlm(process.env, recordLlmCall(db)),
  auth: createAuth(db, {
    secret: required("AUTH_SECRET"),
    baseUrl: required("PUBLIC_URL"),
    trustedOrigins: [...corsOrigins, ...list("APP_SCHEMES")],
    apple:
      APPLE_CLIENT_ID && APPLE_CLIENT_SECRET && APPLE_BUNDLE_ID
        ? {
            clientId: APPLE_CLIENT_ID,
            clientSecret: APPLE_CLIENT_SECRET,
            appBundleIdentifier: APPLE_BUNDLE_ID,
          }
        : undefined,
    google:
      GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
        ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET }
        : undefined,
  }),
  corsOrigins,
  imageDir: process.env.IMAGE_DIR || undefined,
  ownerEmails: list("OWNER_EMAILS").map((email) => email.toLowerCase()),
});

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
