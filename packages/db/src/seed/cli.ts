#!/usr/bin/env bun
import { join } from "node:path";
import { createDb } from "../client";
import { migrate } from "../migrate";
import { upsertDeviceProfiles } from "./device-profiles";
import { parseIngredientSeed, SeedError, upsertIngredients } from "./ingredients";

const [dir] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (!dir || !databaseUrl) {
  console.error(
    "usage: DATABASE_URL=... seed <directory with ingredients.tsv and device_profiles.json>",
  );
  process.exit(2);
}

try {
  const rows = parseIngredientSeed(await Bun.file(join(dir, "ingredients.tsv")).text());
  const { db, pool } = createDb(databaseUrl);
  await migrate(pool);
  await upsertIngredients(db, rows);
  const profiles = await upsertDeviceProfiles(
    db,
    await Bun.file(join(dir, "device_profiles.json")).text(),
  );
  await pool.end();
  console.log(`seeded ${rows.length} ingredients and ${profiles.length} device profile(s)`);
} catch (error) {
  if (!(error instanceof SeedError)) throw error;
  console.error(error.message);
  process.exit(1);
}
