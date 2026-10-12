import { createDb, migrate, recordLlmCall, schema } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import { ingredientText } from "@snapcook/recognition";
import { eq, isNull } from "drizzle-orm";

/** `corpus embed-ingredients`. Embeds every ingredient that has no embedding yet. */
export async function embedIngredients() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(databaseUrl);
  await migrate(pool);
  const llm = createOpenRouterLlm(process.env, recordLlmCall(db));
  const { ingredients } = schema;
  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name, aliases: ingredients.aliases })
    .from(ingredients)
    .where(isNull(ingredients.embedding));
  const vectors = await llm.embed(
    rows.map((row) => ingredientText(row.name, row.aliases)),
    { endpoint: "corpus.embed_ingredients", household_id: null },
  );
  for (const [i, row] of rows.entries()) {
    await db.update(ingredients).set({ embedding: vectors[i] }).where(eq(ingredients.id, row.id));
  }
  console.log(`embedded ${rows.length} ingredient(s)`);
  await pool.end();
}
