import { type IngredientSeed, IngredientSeed as IngredientSeedSchema } from "@snapcook/schema";
import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { ingredients } from "../tables/corpus";

const COLUMNS = [
  "name",
  "aliases",
  "category",
  "allergens",
  "contains",
  "default_unit",
  "grams_per_unit",
  "ml_per_unit",
  "is_staple_default",
] as const;

const list = (cell: string) =>
  cell
    .split("|")
    .map((v) => v.trim())
    .filter(Boolean);

const numberOrNull = (cell: string) => (cell.trim() === "" ? null : Number(cell));

/** The key two names share when a person would read them as the same ingredient. */
export const foldName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export class SeedError extends Error {
  constructor(readonly problems: string[]) {
    super(`ingredient seed has ${problems.length} problem(s):\n${problems.join("\n")}`);
  }
}

/**
 * Parses the tab-separated ingredient list. Lists inside a cell use `|`.
 * Throws a SeedError that names every bad row, so one run shows all of them.
 */
export function parseIngredientSeed(tsv: string): IngredientSeed[] {
  const [header, ...lines] = tsv.split("\n").filter((line) => line.trim() !== "");
  const problems: string[] = [];
  if (header?.split("\t").join(",") !== COLUMNS.join(",")) {
    throw new SeedError([`header must be: ${COLUMNS.join("\t")}`]);
  }

  const rows: IngredientSeed[] = [];
  const owners = new Map<string, string>();

  lines.forEach((line, i) => {
    const at = `line ${i + 2}`;
    const cells = line.split("\t");
    if (cells.length !== COLUMNS.length) {
      problems.push(`${at}: expected ${COLUMNS.length} cells, found ${cells.length}`);
      return;
    }
    const [name, aliases, category, allergens, contains, unit, grams, ml, staple] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const parsed = IngredientSeedSchema.safeParse({
      name: foldName(name),
      aliases: list(aliases).map(foldName),
      category: category.trim(),
      allergens: list(allergens),
      contains: list(contains),
      default_unit: unit.trim(),
      grams_per_unit: numberOrNull(grams),
      ml_per_unit: numberOrNull(ml),
      is_staple_default: staple.trim() === "true",
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`${at} (${name}): ${issue.path.join(".")} ${issue.message}`);
      }
      return;
    }
    const row = parsed.data;
    if (!["true", "false"].includes(staple.trim())) {
      problems.push(`${at} (${row.name}): is_staple_default must be true or false`);
    }
    // Count-to-weight conversion needs a weight for every ingredient that is counted.
    if (row.default_unit === "piece" && row.grams_per_unit === null) {
      problems.push(`${at} (${row.name}): a counted ingredient needs grams_per_unit`);
    }
    for (const key of [row.name, ...row.aliases]) {
      const owner = owners.get(key);
      if (owner !== undefined) {
        problems.push(`${at} (${row.name}): "${key}" is already a name or alias of "${owner}"`);
      }
      owners.set(key, row.name);
    }
    rows.push(row);
  });

  if (problems.length > 0) throw new SeedError(problems);
  return rows;
}

/** Inserts new ingredients and updates existing ones by name. Never deletes. */
export async function upsertIngredients(db: Db, rows: IngredientSeed[]) {
  if (rows.length === 0) return;
  await db
    .insert(ingredients)
    .values(rows)
    .onConflictDoUpdate({
      target: ingredients.name,
      set: {
        aliases: sql`excluded.aliases`,
        category: sql`excluded.category`,
        allergens: sql`excluded.allergens`,
        contains: sql`excluded.contains`,
        default_unit: sql`excluded.default_unit`,
        grams_per_unit: sql`excluded.grams_per_unit`,
        ml_per_unit: sql`excluded.ml_per_unit`,
        is_staple_default: sql`excluded.is_staple_default`,
      },
    });
}
