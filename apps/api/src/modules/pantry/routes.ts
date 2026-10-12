import { zValidator } from "@hono/zod-validator";
import { type Db, schema } from "@snapcook/db";
import {
  Id,
  type PantryAddInput,
  PantryAddInput as PantryAddInputSchema,
  type PantryItem,
  PantryPatch,
  toGrams,
} from "@snapcook/schema";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fail, type HouseholdEnv } from "../../http";
import type { IngredientMatcher } from "./match";
import { parseEntry } from "./parse";

const { ingredients, pantryItems } = schema;

const SEARCH_LIMIT = 12;

type Incoming = Pick<
  PantryItem,
  "ingredient_id" | "display_name" | "quantity" | "unit" | "location" | "use_soon" | "expires_on"
>;

/** Turns what the client sent into the fields of an item. Typed text is parsed and matched. */
async function incoming(input: PantryAddInput, matcher: IngredientMatcher): Promise<Incoming> {
  if (!("text" in input)) {
    return { ...input, use_soon: input.use_soon ?? false, expires_on: input.expires_on ?? null };
  }
  const base = { location: input.location, use_soon: false, expires_on: null };
  // A canonical name can start with a number ("00 flour"), so the whole text is tried first.
  const whole = await matcher.match(input.text);
  if (whole) {
    return {
      ...base,
      ingredient_id: whole.id,
      display_name: input.text,
      quantity: null,
      unit: null,
    };
  }
  const parsed = parseEntry(input.text);
  const hit = await matcher.match(parsed.name);
  return {
    ...base,
    ingredient_id: hit?.id ?? null,
    display_name: parsed.name,
    quantity: parsed.quantity,
    unit: parsed.unit,
  };
}

/** The quantity after adding one amount to another. Null means "some": the amounts do not add. */
async function added(db: Db, existing: PantryItem, extra: Incoming) {
  if (existing.quantity === null || extra.quantity === null) return { quantity: null, unit: null };
  if (existing.unit === extra.unit) {
    return { quantity: existing.quantity + extra.quantity, unit: existing.unit };
  }
  if (!existing.ingredient_id || !existing.unit || !extra.unit)
    return { quantity: null, unit: null };
  const [ingredient] = await db
    .select()
    .from(ingredients)
    .where(eq(ingredients.id, existing.ingredient_id));
  if (!ingredient) return { quantity: null, unit: null };
  const a = toGrams(existing.quantity, existing.unit, ingredient);
  const b = toGrams(extra.quantity, extra.unit, ingredient);
  if (a === null || b === null) return { quantity: null, unit: null };
  return { quantity: Math.round((a + b) * 100) / 100, unit: "g" as const };
}

export function pantryRoutes(db: Db, matcher: IngredientMatcher) {
  const idParam = zValidator("param", z.object({ id: Id }), (result, c) =>
    result.success ? undefined : fail(c, 404, "not_found", "No such item."),
  );
  const mine = (householdId: string, id: string) =>
    and(eq(pantryItems.household_id, householdId), eq(pantryItems.id, id));

  return new Hono<HouseholdEnv>()
    .get("/pantry", async (c) => {
      const items = await db
        .select()
        .from(pantryItems)
        .where(eq(pantryItems.household_id, c.var.household.id))
        .orderBy(asc(pantryItems.location), asc(pantryItems.display_name));
      return c.json({ items });
    })
    .post(
      "/pantry/items",
      zValidator("json", PantryAddInputSchema, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "The item is not valid."),
      ),
      async (c) => {
        const input = c.req.valid("json");
        const householdId = c.var.household.id;
        const item = await incoming(input, matcher);
        const [existing] = item.ingredient_id
          ? await db
              .select()
              .from(pantryItems)
              .where(
                and(
                  eq(pantryItems.household_id, householdId),
                  eq(pantryItems.ingredient_id, item.ingredient_id),
                  eq(pantryItems.location, item.location),
                ),
              )
              .orderBy(desc(pantryItems.updated_at))
              .limit(1)
          : [];
        if (existing && !input.merge) {
          return c.json({ outcome: "merge_needed" as const, existing, incoming: item });
        }
        if (existing && input.merge !== "separate") {
          const amount =
            input.merge === "add"
              ? await added(db, existing, item)
              : { quantity: item.quantity, unit: item.unit };
          const [merged] = await db
            .update(pantryItems)
            .set({
              ...amount,
              ...(input.merge === "replace"
                ? { display_name: item.display_name, expires_on: item.expires_on }
                : {}),
              use_soon: existing.use_soon || item.use_soon,
              updated_at: new Date(),
            })
            .where(mine(householdId, existing.id))
            .returning();
          if (!merged) return fail(c, 404, "not_found", "The item is gone.");
          return c.json({ outcome: "merged" as const, item: merged });
        }
        const [created] = await db
          .insert(pantryItems)
          .values({ ...item, household_id: householdId, source: "manual" })
          .returning();
        if (!created) throw new Error("pantry insert returned nothing");
        return c.json({ outcome: "created" as const, item: created }, 201);
      },
    )
    .patch(
      "/pantry/items/:id",
      idParam,
      zValidator("json", PantryPatch, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "The change is not valid."),
      ),
      async (c) => {
        const [item] = await db
          .update(pantryItems)
          .set({ ...c.req.valid("json"), updated_at: new Date() })
          .where(mine(c.var.household.id, c.req.valid("param").id))
          .returning();
        return item ? c.json({ item }) : fail(c, 404, "not_found", "No such item.");
      },
    )
    .delete("/pantry/items/:id", idParam, async (c) => {
      const removed = await db
        .delete(pantryItems)
        .where(mine(c.var.household.id, c.req.valid("param").id))
        .returning({ id: pantryItems.id });
      return removed.length > 0 ? c.body(null, 204) : fail(c, 404, "not_found", "No such item.");
    })
    .get(
      "/ingredients",
      zValidator("query", z.object({ q: z.string().trim().min(1).max(60) }), (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "Give a search text."),
      ),
      async (c) => {
        const q = c.req.valid("query").q.replace(/[%_\\]/g, "\\$&");
        const inAliases = sql`exists (select 1 from unnest(${ingredients.aliases}) alias where alias ilike ${`%${q}%`})`;
        const found = await db
          .select({ id: ingredients.id, name: ingredients.name, category: ingredients.category })
          .from(ingredients)
          .where(or(ilike(ingredients.name, `%${q}%`), inAliases))
          // Names that start with the text come first, then the shorter name.
          .orderBy(
            sql`${ingredients.name} not ilike ${`${q}%`}`,
            sql`length(${ingredients.name})`,
            asc(ingredients.name),
          )
          .limit(SEARCH_LIMIT);
        return c.json({ ingredients: found });
      },
    );
}
