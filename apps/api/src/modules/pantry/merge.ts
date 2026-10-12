import { type Db, schema } from "@snapcook/db";
import { type MergeChoice, type PantryItem, toGrams, type Unit } from "@snapcook/schema";
import { and, eq } from "drizzle-orm";

const { ingredients, pantryItems } = schema;

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Incoming = Pick<
  PantryItem,
  "ingredient_id" | "display_name" | "quantity" | "unit" | "location" | "use_soon" | "expires_on"
>;

type Amount = { quantity: number | null; unit: Unit | null };

/**
 * The amount after adding one to another, for one ingredient. Null means "some": one side has
 * no amount, or the two units have no conversion for this ingredient.
 */
export async function sumAmounts(
  db: Db | Tx,
  ingredientId: string | null,
  held: Amount,
  extra: Amount,
): Promise<Amount> {
  if (held.quantity === null || extra.quantity === null) return { quantity: null, unit: null };
  if (held.unit === extra.unit) {
    return { quantity: held.quantity + extra.quantity, unit: held.unit };
  }
  if (!ingredientId || !held.unit || !extra.unit) return { quantity: null, unit: null };
  const [ingredient] = await db.select().from(ingredients).where(eq(ingredients.id, ingredientId));
  if (!ingredient) return { quantity: null, unit: null };
  const a = toGrams(held.quantity, held.unit, ingredient);
  const b = toGrams(extra.quantity, extra.unit, ingredient);
  if (a === null || b === null) return { quantity: null, unit: null };
  return { quantity: Math.round((a + b) * 100) / 100, unit: "g" };
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
      ? await sumAmounts(db, existing.ingredient_id, existing, item)
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
