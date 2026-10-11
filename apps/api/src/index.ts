import { createDb, migrate } from "@snapcook/db";
import { createApp } from "./app";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const { db, pool } = createDb(databaseUrl);
await migrate(pool);

const app = createApp({
  db,
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
});

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
