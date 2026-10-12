import { convert, type Deduction, type PantryItem } from "@snapcook/schema";

type Conversions = { grams_per_unit: number | null; ml_per_unit: number | null };

export type DrawDown = {
  /** Pantry items to set to a new amount. */
  update: { id: string; quantity: number }[];
  /** Pantry items that are used up. */
  remove: PantryItem[];
  /** What was taken, in each pantry item's own unit. */
  applied: Deduction[];
  /** Deductions with no conversion into their pantry item's unit. When any exist, nothing is applied. */
  needsInput: Deduction[];
};

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Works out what a finished cook takes from the pantry. It changes nothing itself.
 * A deduction is converted into the unit its pantry item is kept in. An item with no amount is
 * left alone. An assumed staple is never drawn down. An item that reaches zero is removed.
 */
export function drawDown(
  deductions: Deduction[],
  pantry: Map<string, PantryItem>,
  conversions: Map<string, Conversions>,
  staples: Set<string>,
): DrawDown {
  const left = new Map<string, number>();
  const taken = new Map<string, number>();
  const needsInput: Deduction[] = [];

  for (const deduction of deductions) {
    const item = pantry.get(deduction.pantry_item_id);
    // An item another member removed in the meantime, or one kept as "some": nothing to take.
    if (!item || item.quantity === null || item.unit === null) continue;
    if (item.ingredient_id && staples.has(item.ingredient_id)) continue;
    const facts = item.ingredient_id ? conversions.get(item.ingredient_id) : undefined;
    const amount =
      deduction.unit === item.unit
        ? deduction.quantity
        : facts
          ? convert(deduction.quantity, deduction.unit, item.unit, facts)
          : null;
    if (amount === null) {
      needsInput.push(deduction);
      continue;
    }
    const before = left.get(item.id) ?? item.quantity;
    const after = Math.max(0, round(before - amount));
    left.set(item.id, after);
    taken.set(item.id, round((taken.get(item.id) ?? 0) + (before - after)));
  }
  if (needsInput.length > 0) return { update: [], remove: [], applied: [], needsInput };

  const update: DrawDown["update"] = [];
  const remove: PantryItem[] = [];
  const applied: Deduction[] = [];
  for (const [id, quantity] of left) {
    const item = pantry.get(id);
    if (!item?.unit) continue;
    if (quantity === 0) remove.push(item);
    else update.push({ id, quantity });
    applied.push({ pantry_item_id: id, quantity: taken.get(id) ?? 0, unit: item.unit });
  }
  return { update, remove, applied, needsInput: [] };
}
