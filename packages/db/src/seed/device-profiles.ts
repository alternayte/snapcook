import { DeviceProfileSeed } from "@snapcook/schema";
import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { deviceProfiles } from "../tables/corpus";

/** Validates the device profile file and replaces each profile by id. */
export async function upsertDeviceProfiles(db: Db, json: string) {
  const rows = DeviceProfileSeed.parse(JSON.parse(json));
  if (rows.length === 0) return rows;
  await db
    .insert(deviceProfiles)
    .values(rows)
    .onConflictDoUpdate({
      target: deviceProfiles.id,
      set: { name: sql`excluded.name`, capabilities: sql`excluded.capabilities` },
    });
  return rows;
}
