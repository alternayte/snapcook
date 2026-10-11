import { join } from "node:path";
import { createDb, migrate, recordLlmCall, schema } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { loadGridConfig, proposalPrompt, proposalSchema } from "./config";
import { similarEarlier, withoutKnownNames } from "./dedupe";
import { parseGrid, renderGrid } from "./markdown";
import { preferredShare, selectBatch } from "./select";

const { dishCandidates } = schema;

// Above this cosine, two dish descriptions are close enough for a person to compare them.
const SIMILARITY_THRESHOLD = 0.9;

const describe = (d: {
  name: string;
  cuisine: string;
  primary_protein: string;
  technique: string;
}) => `${d.name}; ${d.cuisine}; ${d.primary_protein}; ${d.technique}`;

async function open() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const handle = createDb(databaseUrl);
  await migrate(handle.pool);
  return handle;
}

/** Asks the writer for dishes, one cuisine at a time. A cuisine that already has candidates is skipped. */
async function propose(dir: string) {
  const config = await loadGridConfig(join(dir, "grid.json"));
  const { db, pool } = await open();
  const llm = createOpenRouterLlm(process.env, recordLlmCall(db));
  const ctx = { endpoint: "corpus.grid", household_id: null };

  for (const cuisine of config.cuisines) {
    const existing = await db.select().from(dishCandidates);
    if (existing.some((row) => row.cuisine === cuisine.id)) {
      console.log(`${cuisine.id}: already proposed, skipped`);
      continue;
    }
    const { dishes } = await llm.structured(
      { system: config.system, prompt: proposalPrompt(config, cuisine) },
      proposalSchema(config),
      { ...ctx, role: "write" },
    );
    const fresh = withoutKnownNames(dishes, existing);
    if (fresh.length > 0) {
      await db.insert(dishCandidates).values(fresh.map((d) => ({ ...d, cuisine: cuisine.id })));
    }
    console.log(
      `${cuisine.id}: ${fresh.length} new, ${dishes.length - fresh.length} already known`,
    );
  }

  const missing = await db.select().from(dishCandidates).where(isNull(dishCandidates.embedding));
  if (missing.length > 0) {
    const vectors = await llm.embed(missing.map(describe), ctx);
    for (const [i, row] of missing.entries()) {
      await db
        .update(dishCandidates)
        .set({ embedding: vectors[i] })
        .where(eq(dishCandidates.id, row.id));
    }
  }

  const all = await db
    .select()
    .from(dishCandidates)
    .orderBy(asc(dishCandidates.created_at), asc(dishCandidates.id));
  const marks = similarEarlier(
    all.flatMap((row) => (row.embedding ? [{ id: row.id, embedding: row.embedding }] : [])),
    SIMILARITY_THRESHOLD,
  );
  await db.update(dishCandidates).set({ similar_to: null });
  for (const [id, similarTo] of marks) {
    await db.update(dishCandidates).set({ similar_to: similarTo }).where(eq(dishCandidates.id, id));
  }
  console.log(`${all.length} candidates, ${marks.size} marked as similar to an earlier one`);
  await pool.end();
}

async function exportGrid(dir: string) {
  const { db, pool } = await open();
  const rows = await db.select().from(dishCandidates);
  await Bun.write(join(dir, "grid.md"), renderGrid(rows));
  console.log(`wrote ${rows.length} candidates to ${join(dir, "grid.md")}`);
  await pool.end();
}

async function importGrid(dir: string) {
  const { db, pool } = await open();
  const rows = await db.select({ name: dishCandidates.name }).from(dishCandidates);
  const { kept, dropped } = parseGrid(
    await Bun.file(join(dir, "grid.md")).text(),
    rows.map((row) => row.name),
  );
  await db.transaction(async (tx) => {
    if (kept.length > 0) {
      await tx
        .update(dishCandidates)
        .set({ status: "kept" })
        .where(inArray(dishCandidates.name, kept));
    }
    if (dropped.length > 0) {
      await tx
        .update(dishCandidates)
        .set({ status: "dropped" })
        .where(inArray(dishCandidates.name, dropped));
    }
  });
  console.log(`${kept.length} kept, ${dropped.length} dropped`);
  await pool.end();
}

/** Assigns the next writing batch from kept dishes that have none, and writes the list to a file. */
async function select(dir: string, [sizeArg]: string[]) {
  const size = Number(sizeArg);
  if (!Number.isInteger(size) || size <= 0) throw new Error("usage: corpus grid select <size>");
  const config = await loadGridConfig(join(dir, "grid.json"));
  const { db, pool } = await open();
  const all = await db.select().from(dishCandidates);
  const batch = Math.max(0, ...all.map((row) => row.batch ?? 0)) + 1;
  const free = all.filter((row) => row.status === "kept" && row.batch === null);
  const picked = selectBatch(free, size, config.selection);
  const share = preferredShare(picked, config.selection);
  if (share < config.selection.min_preferred_share) {
    throw new Error(
      `only ${Math.round(share * 100)}% of the batch uses a preferred technique; raise preferred_technique_weight`,
    );
  }
  await db
    .update(dishCandidates)
    .set({ batch })
    .where(
      and(
        inArray(
          dishCandidates.id,
          picked.map((d) => d.id),
        ),
        isNull(dishCandidates.batch),
      ),
    );
  const lines = picked
    .sort((a, b) => a.cuisine.localeCompare(b.cuisine) || a.name.localeCompare(b.name))
    .map(
      (d) =>
        `- ${d.cuisine} — **${d.name}** — ${d.primary_protein} · ${d.technique} · ${d.time_band}`,
    );
  await Bun.write(
    join(dir, `batch-${batch}.md`),
    [`# Batch ${batch} (${picked.length} dishes)`, "", ...lines, ""].join("\n"),
  );
  console.log(
    `batch ${batch}: ${picked.length} dishes, ${Math.round(share * 100)}% with a preferred technique`,
  );
  await pool.end();
}

const actions: Record<string, (dir: string, args: string[]) => Promise<void>> = {
  propose,
  export: exportGrid,
  import: importGrid,
  select,
};

/** `corpus grid <propose|export|import|select> [args]`. The data directory is CORPUS_DIR. */
export async function grid([action, ...args]: string[]) {
  const run = action ? actions[action] : undefined;
  if (!run) {
    console.error(`usage: corpus grid <${Object.keys(actions).join("|")}> [args]`);
    process.exit(2);
  }
  await run(process.env.CORPUS_DIR ?? ".internal/corpus", args);
}
