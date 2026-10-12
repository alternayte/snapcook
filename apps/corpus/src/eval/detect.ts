import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { createDb, migrate, recordLlmCall } from "@snapcook/db";
import { createOpenRouterLlm } from "@snapcook/llm";
import { createIngredientMatcher, detect, toProposals } from "@snapcook/recognition";
import { Location } from "@snapcook/schema";
import { z } from "zod";

/**
 * The labels file: for each photo, where it was taken and the ingredients a person accepts as
 * visible in it, by canonical name. A photo with nothing edible has an empty list.
 */
export const Labels = z.record(
  z.string(),
  z.object({ location: Location, ingredients: z.array(z.string().min(1)) }),
);

export type PhotoScore = { hits: number; proposed: number; expected: number };

/** Counts for one photo: each distinct ingredient is counted once on each side. */
export function scorePhoto(proposed: string[], expected: string[]): PhotoScore {
  const got = new Set(proposed);
  const want = new Set(expected);
  return {
    hits: [...got].filter((name) => want.has(name)).length,
    proposed: got.size,
    expected: want.size,
  };
}

export function summarise(scores: PhotoScore[]) {
  const sum = (key: keyof PhotoScore) => scores.reduce((total, s) => total + s[key], 0);
  const precision = sum("proposed") === 0 ? 1 : sum("hits") / sum("proposed");
  const recall = sum("expected") === 0 ? 1 : sum("hits") / sum("expected");
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

const MEDIA: Record<string, "image/jpeg" | "image/png"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};
const PASS_F1 = 0.8;

/** `corpus eval detect [dir]`. Runs detection on the labelled photos and reports how well it did. */
export async function evalDetect([dir = ".internal/golden"]: string[]) {
  const labels = Labels.parse(await Bun.file(join(dir, "labels.json")).json());
  const photos = (await readdir(dir)).filter((name) => extname(name).toLowerCase() in MEDIA);
  const unlabelled = photos.filter((name) => !(name in labels));
  const missing = Object.keys(labels).filter((name) => !photos.includes(name));
  if (photos.length === 0 || unlabelled.length > 0 || missing.length > 0) {
    console.error(
      [
        `${photos.length} photo(s) in ${dir}.`,
        unlabelled.length > 0 ? `No label for: ${unlabelled.join(", ")}` : "",
        missing.length > 0 ? `Labelled but not found: ${missing.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(databaseUrl);
  await migrate(pool);
  const llm = createOpenRouterLlm(process.env, recordLlmCall(db));
  const matcher = createIngredientMatcher(db);

  let cost = 0;
  const ctx = {
    endpoint: "eval.detect",
    household_id: null,
    onCost: (usd: number) => {
      cost += usd;
    },
  };
  const scores: PhotoScore[] = [];
  for (const name of photos.sort()) {
    const label = labels[name];
    if (!label) continue;
    const started = Date.now();
    const media = MEDIA[extname(name).toLowerCase()] ?? "image/jpeg";
    const seen = await detect(
      llm,
      await Bun.file(join(dir, name)).bytes(),
      media,
      label.location,
      ctx,
    );
    const proposals = await toProposals(seen.items, matcher, llm, ctx);
    const names = await matcher.names();
    const byId = new Map(
      await Promise.all(names.map(async (n) => [(await matcher.match(n))?.id, n] as const)),
    );
    // Free-text proposals count against precision under their own name.
    const proposed = proposals.map((p) => (p.ingredient_id && byId.get(p.ingredient_id)) || p.name);
    const expected = await Promise.all(
      label.ingredients.map(async (n) => (await matcher.match(n))?.name ?? n),
    );
    const score = scorePhoto(proposed, expected);
    scores.push(score);
    const extra = proposed.filter((p) => !expected.includes(p));
    const lost = expected.filter((e) => !proposed.includes(e));
    console.log(
      `${name}: ${score.hits}/${score.expected} found, ${extra.length} extra, ${((Date.now() - started) / 1000).toFixed(1)} s` +
        (lost.length > 0 ? `\n  missed: ${lost.join(", ")}` : "") +
        (extra.length > 0 ? `\n  extra: ${extra.join(", ")}` : ""),
    );
  }
  const { precision, recall, f1 } = summarise(scores);
  console.log(
    `\nprecision ${precision.toFixed(3)}  recall ${recall.toFixed(3)}  F1 ${f1.toFixed(3)}  cost per photo USD ${(cost / scores.length).toFixed(4)}`,
  );
  await pool.end();
  if (f1 < PASS_F1) process.exit(1);
}
