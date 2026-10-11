import { foldName } from "@snapcook/db";

type Named = { name: string; aliases: string[] };

/** Every folded name a dish goes by. */
export const namesOf = (dish: Named) => [dish.name, ...dish.aliases].map(foldName);

/**
 * Keeps the proposals that share no name or alias with a known dish or with an earlier proposal.
 */
export function withoutKnownNames<T extends Named>(proposals: T[], known: Named[]): T[] {
  const taken = new Set(known.flatMap(namesOf));
  return proposals.filter((proposal) => {
    const names = namesOf(proposal);
    if (names.some((name) => taken.has(name))) return false;
    for (const name of names) taken.add(name);
    return true;
  });
}

export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

/**
 * For each item, the id of the closest earlier item at or above the threshold, if there is one.
 * Order matters: the first of two similar dishes stays unmarked.
 */
export function similarEarlier(
  items: { id: string; embedding: number[] }[],
  threshold: number,
): Map<string, string> {
  const marks = new Map<string, string>();
  items.forEach((item, i) => {
    let best: { id: string; score: number } | undefined;
    for (const earlier of items.slice(0, i)) {
      const score = cosine(item.embedding, earlier.embedding);
      if (score >= threshold && (!best || score > best.score)) best = { id: earlier.id, score };
    }
    if (best) marks.set(item.id, best.id);
  });
  return marks;
}
