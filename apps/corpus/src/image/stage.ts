import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  drawOnce,
  drawPicture,
  loadImageConfig,
  type Pictured,
  slugify,
} from "@snapcook/authoring";
import { createDb, type Db, migrate, recordLlmCall, schema } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import type { DishCandidate } from "@snapcook/schema";
import { asc, eq } from "drizzle-orm";
import { parseSelection } from "../pipeline/stage";
import { selectedDishes } from "../pipeline/store";

const { ingredients, recipeImages, recipeIngredients, recipes, recipeVersions } = schema;

const STOP_AFTER_FAILURES = 5;
const CTX = { endpoint: "corpus.image", household_id: null };

async function pictured(db: Db, dish: DishCandidate) {
  if (!dish.recipe_id) return undefined;
  const [row] = await db
    .select({ version: recipeVersions })
    .from(recipes)
    .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
    .where(eq(recipes.id, dish.recipe_id));
  if (!row) return undefined;
  const lines = await db
    .select({ name: ingredients.name, prep: recipeIngredients.prep, role: recipeIngredients.role })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredient_id))
    .where(eq(recipeIngredients.recipe_version_id, row.version.id))
    .orderBy(asc(recipeIngredients.position));
  const { id, title, description, dish_type, steps } = row.version;
  const recipe: Pictured = { title, description, dish_type, steps, ingredients: lines };
  return { versionId: id, recipe };
}

/**
 * `corpus image [--batch n] [--dish name] [--limit n] [--concurrency n] [--preview dir]`.
 * Draws the picture of each published dish that has none, checks it against the recipe, and
 * stores it. A picture that fails the check is drawn once more; a second failure stores no file.
 * With `--preview`, it draws one picture per dish into the directory and stores nothing.
 */
export async function image(args: string[]) {
  const at = args.indexOf("--preview");
  const preview = at === -1 ? undefined : args[at + 1];
  if (at !== -1 && !preview) throw new Error("--preview needs a directory");
  const selection = parseSelection(at === -1 ? args : args.toSpliced(at, 2));
  const model = process.env.MODEL_IMAGE;
  if (!model) throw new Error("MODEL_IMAGE is not set");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(databaseUrl);
  await migrate(pool);
  const corpusDir = process.env.CORPUS_DIR ?? ".internal/corpus";
  const config = await loadImageConfig(join(corpusDir, "image.json"));
  const llm = createOpenRouterLlm(process.env, recordLlmCall(db));
  const dir = preview ?? process.env.IMAGE_DIR ?? "data/images";
  await mkdir(dir, { recursive: true });

  const queue = await selectedDishes(db, selection);
  let worked = 0;
  let failed = 0;
  let failuresInARow = 0;

  async function one(dish: DishCandidate): Promise<string | undefined> {
    const found = await pictured(db, dish);
    if (!found) return undefined;
    if (preview) {
      const result = await drawOnce(llm, config, found.recipe, [], CTX);
      await Bun.write(
        join(dir, `${slugify(dish.name)}--${slugify(model ?? "")}.webp`),
        result.webp,
      );
      return result.faults.length === 0 ? "clean" : `faults: ${result.faults.join("; ")}`;
    }
    const [existing] = await db
      .select({ id: recipeImages.recipe_version_id })
      .from(recipeImages)
      .where(eq(recipeImages.recipe_version_id, found.versionId));
    if (existing) return undefined;
    const result = await drawPicture(llm, config, found.recipe, CTX);
    const passed = result.webp !== null;
    const file = `${found.versionId}.webp`;
    if (result.webp) await Bun.write(join(dir, file), result.webp);
    await db.insert(recipeImages).values({
      recipe_version_id: found.versionId,
      file: passed ? file : null,
      model: model ?? "",
      prompt: result.prompt,
      findings: result.faults,
    });
    return passed ? "stored" : `no picture: ${result.faults.join("; ")}`;
  }

  async function worker() {
    for (;;) {
      if (failuresInARow >= STOP_AFTER_FAILURES) return;
      if (selection.limit !== undefined && worked >= selection.limit) return;
      const dish = queue.shift();
      if (!dish) return;
      try {
        const outcome = await one(dish);
        if (outcome === undefined) continue;
        worked += 1;
        failuresInARow = 0;
        console.log(`${dish.name}: ${outcome}`);
      } catch (error) {
        failed += 1;
        failuresInARow += 1;
        console.log(`${dish.name}: FAILED ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: selection.concurrency ?? 1 }, worker));
  if (failuresInARow >= STOP_AFTER_FAILURES) {
    console.error(`stopped: ${failuresInARow} dishes failed in a row. Run the command again.`);
  }
  console.log(`image: ${worked} dish(es) processed, ${failed} failed`);
  await pool.end();
  if (failed > 0) process.exit(1);
}
