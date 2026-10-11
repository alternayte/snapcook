import { join } from "node:path";
import { createDb, migrate, recordLlmCall } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import type { DishCandidate } from "@snapcook/schema";
import { loadPipelineConfig } from "./config";
import { research } from "./research";
import { type Selection, selectedDishes } from "./store";
import { ingredientList, write } from "./write";

function parseSelection(args: string[]): Selection {
  const selection: Selection = {};
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--batch") selection.batch = Number(value);
    else if (flag === "--limit") selection.limit = Number(value);
    else if (flag === "--dish") selection.dish = value;
    else throw new Error(`unknown option ${flag}`);
  }
  return selection;
}

const STAGES = ["research", "write"] as const;

/** `corpus stage <name> [--batch n] [--dish name] [--limit n]`. `--limit` counts dishes that did work. */
export async function stage([name, ...args]: string[]) {
  if (!STAGES.includes(name as (typeof STAGES)[number])) {
    console.error(
      `usage: corpus stage <${STAGES.join("|")}> [--batch n] [--dish name] [--limit n]`,
    );
    process.exit(2);
  }
  const selection = parseSelection(args);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const dir = process.env.CORPUS_DIR ?? ".internal/corpus";
  const config = await loadPipelineConfig(join(dir, "pipeline.json"));
  const { db, pool } = createDb(databaseUrl);
  await migrate(pool);
  const llm = createOpenRouterLlm(process.env, recordLlmCall(db));
  const ingredients = name === "write" ? await ingredientList(db) : "";

  const run = (dish: DishCandidate) =>
    name === "research"
      ? research(db, llm, config, dish)
      : write(db, llm, config, dish, ingredients);

  let worked = 0;
  let failed = 0;
  for (const dish of await selectedDishes(db, selection)) {
    if (selection.limit !== undefined && worked >= selection.limit) break;
    try {
      const outcome = await run(dish);
      if (outcome !== "skipped") {
        worked += 1;
        console.log(`${name} ${dish.name}: ${outcome}`);
      }
    } catch (error) {
      // One dish failing must not stop the batch; the run is resumable.
      failed += 1;
      console.error(
        `${name} ${dish.name}: FAILED ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  console.log(`${name}: ${worked} processed, ${failed} failed`);
  await pool.end();
  if (failed > 0) process.exit(1);
}
