import { type Db, schema } from "@snapcook/db";
import { type MergeChoice, type PantryItem, toGrams } from "@snapcook/schema";
import { and, eq } from "drizzle-orm";

const { ingredients, pantryItems } = schema;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Incoming = Pick<
  PantryItem,
  "ingredient_id" | "display_name" | "quantity" | "unit" | "location" | "use_soon" | "expires_on"
>;

/** The quantity after adding one amount to another. Null means "some": the amounts do not add. */
async function added(db: Db | Tx, existing: PantryItem, extra: Incoming) {
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

/** Folds a new item into one the household already has: adds to its amount, or replaces it. */
export async function mergeInto(
  db: Db | Tx,
  householdId: string,
  existing: PantryItem,
  item: Incoming,
  choice: Exclude<MergeChoice, "separate">,
) {
  const amount =
    choice === "add"
      ? await added(db, existing, item)
      : { quantity: item.quantity, unit: item.unit };
  const [merged] = await db
    .update(pantryItems)
    .set({
      ...amount,
      ...(choice === "replace"
        ? { display_name: item.display_name, expires_on: item.expires_on }
        : {}),
      use_soon: existing.use_soon || item.use_soon,
      updated_at: new Date(),
    })
    .where(and(eq(pantryItems.household_id, householdId), eq(pantryItems.id, existing.id)))
    .returning();
  return merged;
}
