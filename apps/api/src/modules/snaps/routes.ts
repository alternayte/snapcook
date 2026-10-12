import { zValidator } from "@hono/zod-validator";
import { type Db, schema } from "@snapcook/db";
import { Id, Location, MAX_PHOTO_BYTES, SnapCommitInput } from "@snapcook/schema";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { allowanceExceeded, fail, type HouseholdEnv } from "../../http";
import { consume } from "../billing/usage";
import { mergeInto } from "../pantry/merge";
import { imageKind, storeSnap } from "./service";

const { pantryItems, snaps } = schema;

export type SnapDeps = {
  db: Db;
  /** Directory that holds uploaded photos until they are deleted. */
  snapDir: string;
  /** Queues detection for a stored photo. */
  enqueueDetect: (snapId: string) => Promise<void>;
};

export function snapRoutes({ db, snapDir, enqueueDetect }: SnapDeps) {
  return new Hono<HouseholdEnv>()
    .post(
      "/snaps",
      bodyLimit({
        maxSize: MAX_PHOTO_BYTES,
        onError: (c) => fail(c, 413, "validation", "The photo is too large."),
      }),
      async (c) => {
        const form = await c.req.parseBody();
        const location = Location.safeParse(form.location);
        const photo = form.photo;
        if (!location.success || !(photo instanceof File)) {
          return fail(c, 400, "validation", "Send a photo and where it was taken.");
        }
        const data = new Uint8Array(await photo.arrayBuffer());
        const kind = imageKind(data);
        if (!kind) return fail(c, 400, "validation", "The photo must be a JPEG or a PNG.");
        const refusal = await consume(db, c.var.household, "snaps");
        if (refusal) return allowanceExceeded(c, refusal);
        const snap_id = await storeSnap(db, snapDir, {
          householdId: c.var.household.id,
          userId: c.var.user.id,
          location: location.data,
          data,
          ext: kind.ext,
        });
        await enqueueDetect(snap_id);
        return c.json({ snap_id }, 201);
      },
    )
    .get(
      "/snaps/:id",
      zValidator("param", z.object({ id: Id }), (result, c) =>
        result.success ? undefined : fail(c, 404, "not_found", "No such photo."),
      ),
      async (c) => {
        const [snap] = await db
          .select({ status: snaps.status, location: snaps.location, proposals: snaps.proposals })
          .from(snaps)
          .where(
            and(eq(snaps.household_id, c.var.household.id), eq(snaps.id, c.req.valid("param").id)),
          );
        return snap ? c.json(snap) : fail(c, 404, "not_found", "No such photo.");
      },
    )
    .post(
      "/snaps/commit",
      zValidator("json", SnapCommitInput, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "The items are not valid."),
      ),
      async (c) => {
        const { accepted } = c.req.valid("json");
        const householdId = c.var.household.id;
        const items = await db.transaction(async (tx) => {
          // Only the household's own items can be merged into.
          const wanted = accepted.flatMap((a) => (a.merge ? [a.merge.existing_item_id] : []));
          const owned =
            wanted.length === 0
              ? []
              : await tx
                  .select()
                  .from(pantryItems)
                  .where(
                    and(eq(pantryItems.household_id, householdId), inArray(pantryItems.id, wanted)),
                  );
          const byId = new Map(owned.map((item) => [item.id, item]));
          const out = [];
          for (const { merge, confidence, ...fields } of accepted) {
            const item = { ...fields, use_soon: false, expires_on: null };
            const existing = merge ? byId.get(merge.existing_item_id) : undefined;
            if (existing && merge && merge.choice !== "separate") {
              const merged = await mergeInto(tx, householdId, existing, item, merge.choice);
              if (merged) {
                byId.set(merged.id, merged);
                out.push(merged);
                continue;
              }
            }
            const [created] = await tx
              .insert(pantryItems)
              .values({ ...item, household_id: householdId, source: "photo", confidence })
              .returning();
            if (created) out.push(created);
          }
          return out;
        });
        return c.json({ items });
      },
    );
}
