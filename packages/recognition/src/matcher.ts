import { type Db, foldName, schema } from "@snapcook/db";
import type { CallContext, Llm } from "@snapcook/llm";
import { sql } from "drizzle-orm";
import { nameForms } from "./names";

export type Canonical = { id: string; name: string };

// Ingredients change only when the seed is loaded again, so one read serves many requests.
const TTL_MS = 10 * 60 * 1000;

/** At or above this cosine, a name with no exact match is taken to mean its nearest ingredient. */
export const NEAREST_MIN_SIMILARITY = 0.82;

/** The text an ingredient is embedded as. A name is compared with this. */
export const ingredientText = (name: string, aliases: string[]) => [name, ...aliases].join(", ");

/** Finds the canonical ingredient for a name, by name, alias and singular form, then by meaning. */
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

    /** The ingredient whose embedded text is closest to each name, when it is close enough. */
    async nearest(names: string[], llm: Llm, ctx: CallContext): Promise<(Canonical | undefined)[]> {
      if (names.length === 0) return [];
      const vectors = await llm.embed(names, ctx);
      return Promise.all(
        vectors.map(async (vector) => {
          const literal = JSON.stringify(vector);
          const found = await db.execute<{ id: string; name: string; similarity: number }>(
            sql`select id, name, 1 - (embedding <=> ${literal}::vector) as similarity
                from ingredients where embedding is not null
                order by embedding <=> ${literal}::vector limit 1`,
          );
          const hit = found.rows[0];
          return hit && Number(hit.similarity) >= NEAREST_MIN_SIMILARITY
            ? { id: hit.id, name: hit.name }
            : undefined;
        }),
      );
    },

    /** Every canonical name, once each. */
    async names() {
      return [...new Set([...(await index()).values()].map((c) => c.name))];
    },
  };
}

export type IngredientMatcher = ReturnType<typeof createIngredientMatcher>;
