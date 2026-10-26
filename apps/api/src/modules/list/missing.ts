import { convert, type PantryItem, roundKitchen, type Unit } from "@snapcook/schema";

type Conversions = { grams_per_unit: number | null; ml_per_unit: number | null };

/** One amount a recipe needs. */
export type Need = {
  ingredient_id: string;
  name: string;
  quantity: number | null;
  unit: Unit | null;
  /** An assumed staple: needed only when the pantry holds some and it falls short. */
  staple: boolean;
};

export type Shortfall = {
  ingredient_id: string;
  display_name: string;
  quantity: number | null;
  unit: Unit | null;
};

/**
 * What the pantry lacks for each need, in the unit the pantry keeps the ingredient in. An item
 * kept as "some" counts as enough. An amount that cannot be converted is asked for in full.
 */
export function shortfalls(
  needs: Need[],
  pantry: Pick<PantryItem, "ingredient_id" | "quantity" | "unit">[],
  conversions: Map<string, Conversions>,
): Shortfall[] {
  const out: Shortfall[] = [];
  for (const need of needs) {
    const held = pantry.filter((item) => item.ingredient_id === need.ingredient_id);
    if (need.staple && held.length === 0) continue;
    if (held.some((item) => item.quantity === null || item.unit === null)) continue;
    const line = { ingredient_id: need.ingredient_id, display_name: need.name };
    if (need.quantity === null || need.unit === null) {
      if (held.length === 0) out.push({ ...line, quantity: null, unit: null });
      continue;
    }
    const facts = conversions.get(need.ingredient_id) ?? {
      grams_per_unit: null,
      ml_per_unit: null,
    };
    const unit = held[0]?.unit ?? need.unit;
    const wanted = convert(need.quantity, need.unit, unit, facts);
    if (wanted === null) {
      out.push({ ...line, quantity: need.quantity, unit: need.unit });
      continue;
    }
    let have = 0;
    for (const item of held) {
      if (item.quantity === null || item.unit === null) continue;
      have += convert(item.quantity, item.unit, unit, facts) ?? 0;
    }
    const short = wanted - have;
    if (short <= 0) continue;
    out.push({ ...line, quantity: roundKitchen(short, unit), unit });
  }
  return out;
}
