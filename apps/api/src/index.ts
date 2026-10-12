import { createDb, migrate } from "@snapcook/db";
import { createServer } from "./server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const { db, pool } = createDb(databaseUrl);
await migrate(pool);

const app = createServer({
  db,
  imageDir: process.env.IMAGE_DIR || undefined,
  adminPassword: process.env.ADMIN_PASSWORD || undefined,
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
});

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
