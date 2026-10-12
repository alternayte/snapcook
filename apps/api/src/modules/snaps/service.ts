import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Db, schema } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import { detect, type IngredientMatcher, toProposals } from "@snapcook/recognition";
import type { Location, Meter, SnapProposal } from "@snapcook/schema";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";

const { pantryItems, snaps, usageCounters } = schema;

// A photo is removed this long after upload, so it is always gone within a day.
const PHOTO_LIFETIME_MS = 23 * 60 * 60 * 1000;

const month = (now: Date) => now.toISOString().slice(0, 7);

/** Adds to, or takes back from, a household's use of a meter in the current month. */
export async function meter(
  db: Db,
  householdId: string,
  name: Meter,
  change: 1 | -1,
  now = new Date(),
) {
  await db
    .insert(usageCounters)
    .values({
      household_id: householdId,
      period: month(now),
      meter: name,
      used: Math.max(change, 0),
    })
    .onConflictDoUpdate({
      target: [usageCounters.household_id, usageCounters.period, usageCounters.meter],
      set: { used: sql`greatest(${usageCounters.used} + ${change}, 0)` },
    });
}

const SIGNATURES = [
  { type: "image/jpeg", ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47] },
] as const;

/** The image type the bytes really are, whatever the upload claimed. */
export const imageKind = (data: Uint8Array) =>
  SIGNATURES.find((s) => s.bytes.every((byte, i) => data[i] === byte));

/** Stores an uploaded photo and its row. The caller queues detection. */
export async function storeSnap(
  db: Db,
  snapDir: string,
  input: { householdId: string; userId: string; location: Location; data: Uint8Array; ext: string },
) {
  const id = Bun.randomUUIDv7();
  const storage_path = join(input.householdId, `${id}.${input.ext}`);
  const file = join(snapDir, storage_path);
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, input.data);
  await db.insert(snaps).values({
    id,
    household_id: input.householdId,
    user_id: input.userId,
    location: input.location,
    storage_path,
  });
  await meter(db, input.householdId, "snaps", 1);
  return id;
}

export type DetectionDeps = { db: Db; llm: Llm; matcher: IngredientMatcher; snapDir: string };

/**
 * Runs detection for one stored photo and writes its proposals. It throws when the model fails,
 * so the job runner can try again.
 */
export async function runDetection({ db, llm, matcher, snapDir }: DetectionDeps, snapId: string) {
  const [snap] = await db.select().from(snaps).where(eq(snaps.id, snapId));
  if (!snap || snap.status !== "queued") return;
  const data = await Bun.file(join(snapDir, snap.storage_path)).bytes();
  const kind = imageKind(data);
  if (!kind) throw new Error(`snap ${snapId} is not a JPEG or PNG`);

  let cost = 0;
  const ctx = {
    endpoint: "snaps.detect",
    household_id: snap.household_id,
    onCost: (usd: number) => {
      cost += usd;
    },
  };
  const seen = await detect(llm, data, kind.type, snap.location, ctx);
  const found = await toProposals(seen.items, matcher, llm, ctx);

  // A proposal that matches something already in the same place carries that item's id.
  const stocked = await db
    .select({ id: pantryItems.id, ingredient_id: pantryItems.ingredient_id })
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.household_id, snap.household_id),
        eq(pantryItems.location, snap.location),
        isNotNull(pantryItems.ingredient_id),
      ),
    );
  const existing = new Map(stocked.map((item) => [item.ingredient_id, item.id]));
  const proposals: SnapProposal[] = found.map((p) => ({
    ...p,
    existing_item_id: (p.ingredient_id && existing.get(p.ingredient_id)) || null,
  }));
  await db
    .update(snaps)
    .set({ proposals, status: "done", cost_usd: cost })
    .where(eq(snaps.id, snapId));
}

/** Marks a photo as failed and gives the household its snap back. */
export async function failSnap(db: Db, snapId: string) {
  const [snap] = await db
    .update(snaps)
    .set({ status: "failed" })
    .where(and(eq(snaps.id, snapId), eq(snaps.status, "queued")))
    .returning({ household_id: snaps.household_id });
  if (snap) await meter(db, snap.household_id, "snaps", -1);
}

/** Deletes the files of photos past their lifetime. The rows stay, for counting. */
export async function deleteOldPhotos(db: Db, snapDir: string, now = new Date()) {
  const due = await db
    .select({ id: snaps.id, storage_path: snaps.storage_path })
    .from(snaps)
    .where(
      and(
        isNull(snaps.deleted_at),
        lt(snaps.created_at, new Date(now.getTime() - PHOTO_LIFETIME_MS)),
      ),
    );
  for (const snap of due) {
    await unlink(join(snapDir, snap.storage_path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await db.update(snaps).set({ deleted_at: now }).where(eq(snaps.id, snap.id));
  }
  return due.length;
}
