import { zValidator } from "@hono/zod-validator";
import { type Db, schema } from "@snapcook/db";
import type { IngredientMatcher } from "@snapcook/recognition";
import {
  Aisle,
  Id,
  ListAddInput,
  type ListAddItem,
  ListPatch,
  PutAwayInput,
  type SavedCard,
} from "@snapcook/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fail, type HouseholdEnv, unchanged } from "../../http";
import { mergeInto, sumAmounts } from "../pantry/merge";
import { parseEntry } from "../pantry/parse";
import { aisleFor } from "./aisle";

const {
  ingredients,
  pantryItems,
  recipeImages,
  recipes,
  recipeVersions,
  savedRecipes,
  shoppingItems,
} = schema;

const SERVABLE = ["auto_reviewed", "human_reviewed", "test_cooked"] as const;

type Line = {
  ingredient_id: string | null;
  display_name: string;
  quantity: number | null;
  unit: (typeof shoppingItems.$inferSelect)["unit"];
  recipe_id?: string;
};

/** Typed text is parsed and matched like a pantry entry; a recipe's line is taken as given. */
async function toLine(item: ListAddItem, matcher: IngredientMatcher): Promise<Line> {
  if (!("text" in item)) return item;
  const whole = await matcher.match(item.text);
  // The line keeps the words the person typed.
  if (whole)
    return { ingredient_id: whole.id, display_name: item.text, quantity: null, unit: null };
  const parsed = parseEntry(item.text);
  const hit = await matcher.match(parsed.name);
  return {
    ingredient_id: hit?.id ?? null,
    display_name: parsed.name,
    quantity: parsed.quantity,
    unit: parsed.unit,
  };
}

export function listRoutes(db: Db, matcher: IngredientMatcher) {
  const idParam = zValidator("param", z.object({ id: Id }), (result, c) =>
    result.success ? undefined : fail(c, 404, "not_found", "No such line."),
  );
  const recipeParam = zValidator("param", z.object({ recipeId: Id }), (result, c) =>
    result.success ? undefined : fail(c, 404, "not_found", "No such recipe."),
  );
  const body = <S extends z.ZodType>(shape: S) =>
    zValidator("json", shape, (result, c) =>
      result.success ? undefined : fail(c, 400, "validation", "The request is not valid."),
    );
  const mine = (householdId: string, id: string) =>
    and(eq(shoppingItems.household_id, householdId), eq(shoppingItems.id, id));

  async function list(householdId: string) {
    const rows = await db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.household_id, householdId))
      .orderBy(asc(shoppingItems.display_name));
    // Aisles come in the order a shop is walked, not in the order of their names.
    const items = rows.sort(
      (a, b) => Aisle.options.indexOf(a.aisle) - Aisle.options.indexOf(b.aisle),
    );
    const wanted = [...new Set(items.flatMap((item) => item.wanted_by))];
    const titles =
      wanted.length === 0
        ? []
        : await db
            .select({ id: recipes.id, title: recipeVersions.title })
            .from(recipes)
            .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
            .where(inArray(recipes.id, wanted));
    return { items, recipes: Object.fromEntries(titles.map((t) => [t.id, t.title])) };
  }

  return new Hono<HouseholdEnv>()
    .get("/list", async (c) => {
      if (unchanged(c, c.var.household.list_rev)) return c.body(null, 304);
      return c.json(await list(c.var.household.id));
    })
    .post("/list/items", body(ListAddInput), async (c) => {
      const householdId = c.var.household.id;
      const lines = await Promise.all(
        c.req.valid("json").items.map((item) => toLine(item, matcher)),
      );
      await db.transaction(async (tx) => {
        for (const line of lines) {
          // A line for the same ingredient that is not yet bought takes the new amount as well.
          const [open] = line.ingredient_id
            ? await tx
                .select()
                .from(shoppingItems)
                .where(
                  and(
                    eq(shoppingItems.household_id, householdId),
                    eq(shoppingItems.ingredient_id, line.ingredient_id),
                    eq(shoppingItems.bought, false),
                  ),
                )
                .for("update")
            : [];
          const wanted = line.recipe_id ? [line.recipe_id] : [];
          if (open) {
            await tx
              .update(shoppingItems)
              .set({
                ...(await sumAmounts(tx, line.ingredient_id, open, line)),
                wanted_by: [...new Set([...open.wanted_by, ...wanted])],
              })
              .where(eq(shoppingItems.id, open.id));
            continue;
          }
          const [known] = line.ingredient_id
            ? await tx
                .select({ name: ingredients.name, category: ingredients.category })
                .from(ingredients)
                .where(eq(ingredients.id, line.ingredient_id))
            : [];
          await tx.insert(shoppingItems).values({
            household_id: householdId,
            ingredient_id: known ? line.ingredient_id : null,
            display_name: line.display_name,
            quantity: line.quantity,
            unit: line.unit,
            aisle: aisleFor(known),
            wanted_by: wanted,
          });
        }
      });
      return c.json(await list(householdId), 201);
    })
    .patch("/list/items/:id", idParam, body(ListPatch), async (c) => {
      const [item] = await db
        .update(shoppingItems)
        .set(c.req.valid("json"))
        .where(mine(c.var.household.id, c.req.valid("param").id))
        .returning();
      return item ? c.json({ item }) : fail(c, 404, "not_found", "No such line.");
    })
    .delete("/list/items/:id", idParam, async (c) => {
      const removed = await db
        .delete(shoppingItems)
        .where(mine(c.var.household.id, c.req.valid("param").id))
        .returning({ id: shoppingItems.id });
      return removed.length > 0 ? c.body(null, 204) : fail(c, 404, "not_found", "No such line.");
    })
    .post("/list/put-away", body(PutAwayInput), async (c) => {
      const householdId = c.var.household.id;
      const { location } = c.req.valid("json");
      const moved = await db.transaction(async (tx) => {
        const bought = await tx
          .select()
          .from(shoppingItems)
          .where(and(eq(shoppingItems.household_id, householdId), eq(shoppingItems.bought, true)))
          .for("update");
        for (const line of bought) {
          const item = {
            ingredient_id: line.ingredient_id,
            display_name: line.display_name,
            quantity: line.quantity,
            unit: line.unit,
            location,
            use_soon: false,
            expires_on: null,
          };
          // What is bought joins what is already there, in the same place.
          const [existing] = line.ingredient_id
            ? await tx
                .select()
                .from(pantryItems)
                .where(
                  and(
                    eq(pantryItems.household_id, householdId),
                    eq(pantryItems.ingredient_id, line.ingredient_id),
                    eq(pantryItems.location, location),
                  ),
                )
                .orderBy(desc(pantryItems.updated_at))
                .limit(1)
                .for("update")
            : [];
          if (existing) await mergeInto(tx, householdId, existing, item, "add");
          else {
            await tx
              .insert(pantryItems)
              .values({ ...item, household_id: householdId, source: "shopping_list" });
          }
        }
        if (bought.length > 0) {
          await tx.delete(shoppingItems).where(
            inArray(
              shoppingItems.id,
              bought.map((line) => line.id),
            ),
          );
        }
        return bought.length;
      });
      return c.json({ moved });
    })
    .get("/saved", async (c) => {
      const saved: SavedCard[] = await db
        .select({
          recipe_id: recipes.id,
          title: recipeVersions.title,
          cuisine: recipeVersions.cuisine,
          time_total_min: recipeVersions.time_total_min,
          image: recipeImages.file,
          saved_at: savedRecipes.saved_at,
        })
        .from(savedRecipes)
        .innerJoin(recipes, eq(recipes.id, savedRecipes.recipe_id))
        .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
        .leftJoin(recipeImages, eq(recipeImages.recipe_version_id, recipeVersions.id))
        .where(eq(savedRecipes.household_id, c.var.household.id))
        .orderBy(desc(savedRecipes.saved_at));
      return c.json({ saved });
    })
    .put("/saved/:recipeId", recipeParam, async (c) => {
      const recipeId = c.req.valid("param").recipeId;
      const [recipe] = await db
        .select({ id: recipes.id })
        .from(recipes)
        .where(and(eq(recipes.id, recipeId), inArray(recipes.status, [...SERVABLE])));
      if (!recipe) return fail(c, 404, "not_found", "No such recipe.");
      await db
        .insert(savedRecipes)
        .values({ household_id: c.var.household.id, recipe_id: recipeId })
        .onConflictDoNothing();
      return c.body(null, 204);
    })
    .delete("/saved/:recipeId", recipeParam, async (c) => {
      await db
        .delete(savedRecipes)
        .where(
          and(
            eq(savedRecipes.household_id, c.var.household.id),
            eq(savedRecipes.recipe_id, c.req.valid("param").recipeId),
          ),
        );
      return c.body(null, 204);
    });
}
