import { join } from "node:path";
import { createDb, type Db, migrate, recordLlmCall, schema } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import {
  DeviceVariantDraft,
  type DishCandidate,
  RecipeDraft,
  ReviewVerdict,
  ValidationReport,
} from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { loadGridConfig } from "../grid/config";
import { loadPipelineConfig } from "./config";
import { device } from "./device";
import { publish } from "./publish";
import { research } from "./research";
import { review } from "./review";
import { discardDrafts, latest, type Selection, save, selectedDishes } from "./store";
import { indexIngredients, validateDraft, validateVariant } from "./validate";
import { ingredientList, write } from "./write";

export function parseSelection(args: string[]): Selection {
  const selection: Selection = {};
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--batch") selection.batch = Number(value);
    else if (flag === "--limit") selection.limit = Number(value);
    else if (flag === "--dish") selection.dish = value;
    else if (flag === "--concurrency") selection.concurrency = Number(value);
    else throw new Error(`unknown option ${flag}`);
  }
  return selection;
}

// One full pass, in order. The second write is the single rewrite a failed draft gets.
const FULL_RUN = [
  "research",
  "write",
  "device",
  "validate",
  "review",
  "write",
  "device",
  "validate",
  "review",
  "publish",
] as const;
type StageName = (typeof FULL_RUN)[number];

const STOP_AFTER_FAILURES = 5;
const STAGE_NAMES = [...new Set<string>(FULL_RUN)];

async function context(db: Db) {
  const dir = process.env.CORPUS_DIR ?? ".internal/corpus";
  const config = await loadPipelineConfig(join(dir, "pipeline.json"));
  const grid = await loadGridConfig(join(dir, "grid.json"));
  const llm = createOpenRouterLlm(process.env, recordLlmCall(db));
  const index = indexIngredients(await db.select().from(schema.ingredients));
  const [profile] = await db
    .select()
    .from(schema.deviceProfiles)
    .where(eq(schema.deviceProfiles.id, "mc_smart"));
  if (!profile) throw new Error("the device profile is not seeded; run `just seed`");
  return { config, grid, llm, index, profile, ingredients: await ingredientList(db) };
}
type Context = Awaited<ReturnType<typeof context>>;

/** Runs the deterministic checks on the current draft and its device variant. */
async function validate(db: Db, ctx: Context, dish: DishCandidate) {
  const draft = await latest(db, dish.id, "write", RecipeDraft);
  if (!draft) return "blocked: no draft";
  const variant = await latest(db, dish.id, "device", DeviceVariantDraft);
  if (variant?.attempt !== draft.attempt) return "blocked: no device variant";
  const existing = await latest(db, dish.id, "validate", ValidationReport);
  if (existing?.attempt === draft.attempt) return "skipped";
  const problems = [
    ...validateDraft(draft.value, dish, ctx.index, ctx.config),
    ...validateVariant(variant.value, ctx.profile.capabilities),
  ];
  await save(db, dish.id, "validate", { problems }, draft.attempt);
  return problems.length === 0
    ? "clean"
    : `${problems.length} problem(s): ${problems.map((p) => p.code).join(", ")}`;
}

function runner(db: Db, ctx: Context, name: StageName) {
  const models = {
    writer: process.env.MODEL_WRITE ?? "",
    reviewer: process.env.MODEL_REVIEW ?? "",
  };
  return (dish: DishCandidate): Promise<string> => {
    switch (name) {
      case "research":
        return research(db, ctx.llm, ctx.config, dish);
      case "write":
        return write(db, ctx.llm, ctx.config, dish, ctx.ingredients);
      case "device":
        return device(db, ctx.llm, ctx.config, dish, ctx.profile);
      case "validate":
        return validate(db, ctx, dish);
      case "review":
        return review(db, ctx.llm, ctx.config, ctx.grid, ctx.profile, dish);
      case "publish":
        return publish(db, ctx.llm, dish, ctx.index, models);
    }
  };
}

/**
 * `corpus stage <name|all> [--batch n] [--dish name] [--limit n] [--concurrency n]`.
 * `all` takes each dish through every stage before the next dish. `--limit` counts dishes.
 */
export async function stage([name, ...args]: string[]) {
  if (name !== "all" && !STAGE_NAMES.includes(name ?? "")) {
    console.error(
      `usage: corpus stage <${STAGE_NAMES.join("|")}|all> [--batch n] [--dish name] [--limit n]`,
    );
    process.exit(2);
  }
  const selection = parseSelection(args);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(databaseUrl);
  await migrate(pool);
  const ctx = await context(db);
  const names = name === "all" ? FULL_RUN : [name as StageName];

  let worked = 0;
  let failed = 0;
  let failuresInARow = 0;
  const queue = await selectedDishes(db, selection);

  async function worker() {
    for (;;) {
      // A run of failures means the cause is shared (a usage limit, no credit, no network).
      if (failuresInARow >= STOP_AFTER_FAILURES) return;
      if (selection.limit !== undefined && worked >= selection.limit) return;
      const dish = queue.shift();
      if (!dish) return;
      const outcomes: string[] = [];
      try {
        for (const stageName of names) {
          // Read the dish again: publish sets recipe_id, and a later stage must see it.
          const [fresh] = await db
            .select()
            .from(schema.dishCandidates)
            .where(eq(schema.dishCandidates.id, dish.id));
          const outcome = await runner(db, ctx, stageName)(fresh ?? dish);
          if (outcome !== "skipped") outcomes.push(`${stageName}=${outcome}`);
        }
        if (outcomes.length > 0) failuresInARow = 0;
      } catch (error) {
        // One dish failing must not stop the batch; every finished stage is already stored.
        failed += 1;
        failuresInARow += 1;
        outcomes.push(`FAILED ${error instanceof Error ? error.message : error}`);
      }
      if (outcomes.length > 0) {
        worked += 1;
        console.log(`${dish.name}: ${outcomes.join(" · ")}`);
      }
    }
  }
  await Promise.all(Array.from({ length: selection.concurrency ?? 1 }, worker));
  if (failuresInARow >= STOP_AFTER_FAILURES) {
    console.error(
      `stopped: ${failuresInARow} dishes failed in a row. Run the same command again to resume.`,
    );
  }
  console.log(`${name}: ${worked} dish(es) processed, ${failed} failed`);
  await pool.end();
  if (failed > 0) process.exit(1);
}

/**
 * `corpus redraft [--batch n] [--dish name]`. Discards the drafts of every selected dish that is
 * not published and whose newest draft did not pass review. Research is kept.
 */
export async function redraft(args: string[]) {
  const selection = parseSelection(args);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(databaseUrl);
  let discarded = 0;
  for (const dish of await selectedDishes(db, selection)) {
    if (dish.recipe_id) continue;
    const draft = await latest(db, dish.id, "write", RecipeDraft);
    if (!draft) continue;
    const verdict = await latest(db, dish.id, "review", ReviewVerdict);
    if (verdict?.attempt === draft.attempt && verdict.value.verdict === "pass") continue;
    await discardDrafts(db, dish);
    discarded += 1;
    console.log(dish.name);
  }
  console.log(`redraft: ${discarded} dish(es) reset`);
  await pool.end();
}
