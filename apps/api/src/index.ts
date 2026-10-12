import { createDb, migrate, recordLlmCall } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import { createIngredientMatcher } from "@snapcook/recognition";
import { startJobs } from "./jobs";
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

const llm = createOpenRouterLlm(process.env, recordLlmCall(db));
const matcher = createIngredientMatcher(db);
const snapDir = required("SNAP_DIR");
const jobs = await startJobs(required("DATABASE_URL"), { db, llm, matcher, snapDir });

const app = createServer({
  db,
  llm,
  matcher,
  snaps: { snapDir, enqueueDetect: jobs.enqueueDetect },
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
  adaptModel: required("MODEL_ADAPT"),
  ownerEmails: list("OWNER_EMAILS").map((email) => email.toLowerCase()),
});

process.on("SIGTERM", async () => {
  await jobs.stop();
  process.exit(0);
});

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
