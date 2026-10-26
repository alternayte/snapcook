import { zValidator } from "@hono/zod-validator";
import { type Db, schema } from "@snapcook/db";
import { Id, ImportDraft, MAX_IMPORT_IMAGES, MAX_PHOTO_BYTES } from "@snapcook/schema";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { allowanceExceeded, fail, type HouseholdEnv } from "../../http";
import { consume } from "../billing/usage";
import { imageKind } from "../snaps/service";
import { importView, startEdit, storeImport, submit } from "./service";

const { recipeImports } = schema;

export type ImportRouteDeps = {
  db: Db;
  photoDir: string;
  /** False when the server has no recipe writing prompts: imports are then off. */
  enabled: boolean;
  enqueueRead: (importId: string) => Promise<void>;
  enqueueSave: (importId: string) => Promise<void>;
};

export function importRoutes({ db, photoDir, enabled, enqueueRead, enqueueSave }: ImportRouteDeps) {
  const idParam = zValidator("param", z.object({ id: Id }), (result, c) =>
    result.success ? undefined : fail(c, 404, "not_found", "No such import."),
  );
  const off = (c: Parameters<typeof fail>[0]) =>
    fail(c, 503, "unavailable", "Adding recipes is not set up on this server.");

  return new Hono<HouseholdEnv>()
    .post(
      "/imports",
      bodyLimit({
        maxSize: MAX_PHOTO_BYTES * MAX_IMPORT_IMAGES,
        onError: (c) => fail(c, 413, "validation", "The images are too large."),
      }),
      async (c) => {
        if (!enabled) return off(c);
        const form = await c.req.parseBody({ all: true });
        const sent = form.photo;
        const photos = (Array.isArray(sent) ? sent : [sent]).filter((p) => p instanceof File);
        if (photos.length === 0 || photos.length > MAX_IMPORT_IMAGES) {
          return fail(c, 400, "validation", `Send one to ${MAX_IMPORT_IMAGES} images.`);
        }
        const files: { data: Uint8Array; ext: string }[] = [];
        for (const photo of photos) {
          const data = new Uint8Array(await photo.arrayBuffer());
          const kind = imageKind(data);
          if (!kind) return fail(c, 400, "validation", "Each image must be a JPEG or a PNG.");
          if (data.length > MAX_PHOTO_BYTES) {
            return fail(c, 413, "validation", "The images are too large.");
          }
          files.push({ data, ext: kind.ext });
        }
        const refusal = await consume(db, c.var.household, "imports");
        if (refusal) return allowanceExceeded(c, refusal);
        const import_id = await storeImport(db, photoDir, {
          householdId: c.var.household.id,
          userId: c.var.user.id,
          files,
        });
        await enqueueRead(import_id);
        return c.json({ import_id }, 201);
      },
    )
    .get("/imports/:id", idParam, async (c) => {
      const view = await importView(db, c.var.household.id, c.req.valid("param").id);
      return view ? c.json(view) : fail(c, 404, "not_found", "No such import.");
    })
    .put(
      "/imports/:id",
      idParam,
      zValidator("json", z.object({ draft: ImportDraft }), (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "The recipe is not complete."),
      ),
      async (c) => {
        if (!enabled) return off(c);
        const id = c.req.valid("param").id;
        const [row] = await db
          .select({ status: recipeImports.status, is_edit: recipeImports.is_edit })
          .from(recipeImports)
          .where(and(eq(recipeImports.id, id), eq(recipeImports.household_id, c.var.household.id)));
        if (!row) return fail(c, 404, "not_found", "No such import.");
        // The failure gave the allowance back, so trying again counts again.
        if (row.status === "failed" && !row.is_edit) {
          const refusal = await consume(db, c.var.household, "imports");
          if (refusal) return allowanceExceeded(c, refusal);
        }
        const saved = await submit(db, c.var.household, id, c.req.valid("json").draft);
        if (!saved) return fail(c, 409, "validation", "This import is not waiting for a check.");
        await enqueueSave(id);
        return c.json(await importView(db, c.var.household.id, id), 202);
      },
    )
    .delete("/imports/:id", idParam, async (c) => {
      await db
        .delete(recipeImports)
        .where(
          and(
            eq(recipeImports.id, c.req.valid("param").id),
            eq(recipeImports.household_id, c.var.household.id),
            inArray(recipeImports.status, ["checking", "failed"]),
          ),
        );
      return c.body(null, 204);
    })
    .post(
      "/recipes/:recipeId/edit",
      zValidator("param", z.object({ recipeId: Id }), (result, c) =>
        result.success ? undefined : fail(c, 404, "not_found", "No such recipe."),
      ),
      async (c) => {
        const import_id = await startEdit(
          db,
          c.var.household.id,
          c.var.user.id,
          c.req.valid("param").recipeId,
        );
        return import_id
          ? c.json({ import_id }, 201)
          : fail(c, 404, "not_found", "No such recipe of yours.");
      },
    );
}
