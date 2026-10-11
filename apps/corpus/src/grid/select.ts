import type { GridConfig } from "./config";

type Dish = {
  id: string;
  name: string;
  cuisine: string;
  primary_protein: string;
  technique: string;
};

/**
 * Picks `size` dishes for a writing batch. It takes one dish per cuisine in turn, so cuisines stay
 * level, and inside a cuisine it takes the best-scoring dish left. A dish scores higher for a
 * weighted protein and a preferred technique, and lower for each picked dish it repeats.
 */
export function selectBatch<T extends Dish>(
  dishes: T[],
  size: number,
  rules: GridConfig["selection"],
): T[] {
  const left = new Map<string, T[]>();
  for (const dish of [...dishes].sort((a, b) => a.name.localeCompare(b.name))) {
    left.set(dish.cuisine, [...(left.get(dish.cuisine) ?? []), dish]);
  }
  const picked: T[] = [];
  const repeats = new Map<string, number>();
  const pair = (d: Dish) => `${d.primary_protein}/${d.technique}`;
  const score = (d: Dish) =>
    (rules.protein_weights[d.primary_protein] ?? 0) +
    (rules.preferred_techniques.includes(d.technique) ? rules.preferred_technique_weight : 0) -
    rules.repeat_penalty * (repeats.get(pair(d)) ?? 0);

  const cuisines = [...left.keys()].sort();
  while (picked.length < size && cuisines.some((c) => (left.get(c) ?? []).length > 0)) {
    for (const cuisine of cuisines) {
      const pool = left.get(cuisine) ?? [];
      if (picked.length >= size || pool.length === 0) continue;
      const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
      pool.splice(pool.indexOf(best), 1);
      picked.push(best);
      repeats.set(pair(best), (repeats.get(pair(best)) ?? 0) + 1);
    }
  }
  return picked;
}

export const preferredShare = (dishes: Dish[], rules: GridConfig["selection"]) =>
  dishes.filter((d) => rules.preferred_techniques.includes(d.technique)).length /
  Math.max(dishes.length, 1);
