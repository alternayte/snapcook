import { type Db, foldName, schema } from "@snapcook/db";
import { nameForms } from "./parse";

export type Canonical = { id: string; name: string };

// Ingredients change only when the seed is loaded again, so one read serves many requests.
const TTL_MS = 10 * 60 * 1000;

/** Finds the canonical ingredient for a name a person typed, by name, alias and singular form. */
export function createIngredientMatcher(db: Db) {
  let loaded: { at: number; index: Promise<Map<string, Canonical>> } | undefined;

  function index() {
    if (!loaded || Date.now() - loaded.at > TTL_MS) {
      const rows = db
        .select({
          id: schema.ingredients.id,
          name: schema.ingredients.name,
          aliases: schema.ingredients.aliases,
        })
        .from(schema.ingredients);
      loaded = {
        at: Date.now(),
        index: rows.then((list) => {
          const map = new Map<string, Canonical>();
          for (const row of list) {
            for (const name of [...row.aliases, row.name])
              map.set(foldName(name), { id: row.id, name: row.name });
          }
          return map;
        }),
      };
    }
    return loaded.index;
  }

  return {
    async match(name: string): Promise<Canonical | undefined> {
      const map = await index();
      for (const form of nameForms(name)) {
        const hit = map.get(form);
        if (hit) return hit;
      }
      return undefined;
    },
    /** Every canonical name, once each. */
    async names() {
      return [...new Set([...(await index()).values()].map((c) => c.name))];
    },
  };
}

export type IngredientMatcher = ReturnType<typeof createIngredientMatcher>;
