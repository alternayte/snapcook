import type { DishCandidate } from "@snapcook/schema";

type Row = Pick<
  DishCandidate,
  | "id"
  | "name"
  | "aliases"
  | "cuisine"
  | "dish_type"
  | "primary_protein"
  | "technique"
  | "time_band"
  | "status"
  | "similar_to"
>;

const tally = (rows: Row[], key: (row: Row) => string) => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
};

/**
 * The list a person prunes. A ticked box keeps the dish; an unticked box or a deleted line drops it.
 * Only the box and the name are read back, so the rest of a line is free to annotate.
 */
export function renderGrid(rows: Row[]): string {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out = [
    "# Dish grid",
    "",
    "Tick `[x]` to keep a dish. Untick it or delete its line to drop it. Do not edit a name.",
    "",
    `${rows.length} candidates.`,
    "",
    "## Coverage",
    "",
    ...tally(rows, (r) => `${r.primary_protein} · ${r.technique}`).map(([k, n]) => `- ${k}: ${n}`),
    "",
  ];
  for (const [cuisine] of tally(rows, (r) => r.cuisine).sort((a, b) => a[0].localeCompare(b[0]))) {
    const dishes = rows
      .filter((r) => r.cuisine === cuisine)
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push(`## ${cuisine} (${dishes.length})`, "");
    for (const dish of dishes) {
      const similar = dish.similar_to ? byId.get(dish.similar_to) : undefined;
      // A dish that resembles an earlier one starts unticked: the person decides.
      const box = dish.status === "dropped" || similar ? " " : "x";
      const details = [dish.dish_type, dish.primary_protein, dish.technique, dish.time_band];
      const aliases = dish.aliases.length > 0 ? ` (also: ${dish.aliases.join(", ")})` : "";
      const note = similar ? ` — similar to **${similar.name}**` : "";
      out.push(`- [${box}] **${dish.name}** — ${details.join(" · ")}${aliases}${note}`);
    }
    out.push("");
  }
  return out.join("\n");
}

export class GridFileError extends Error {}

/** Reads the pruned list back: which names are kept and which are dropped. */
export function parseGrid(markdown: string, knownNames: string[]) {
  const known = new Set(knownNames);
  const kept = new Set<string>();
  const unknown: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^- \[([ xX])\] \*\*(.+?)\*\*/.exec(line);
    if (!match) continue;
    const [, box, name] = match as unknown as [string, string, string];
    if (!known.has(name)) unknown.push(name);
    else if (box !== " ") kept.add(name);
  }
  if (unknown.length > 0) {
    throw new GridFileError(
      `the grid file names dishes that are not candidates: ${unknown.join(", ")}`,
    );
  }
  return { kept: [...kept], dropped: knownNames.filter((name) => !kept.has(name)) };
}
