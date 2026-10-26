import type { PipelineConfig } from "@snapcook/authoring";
import type { Db } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import { type DishCandidate, ResearchNotes } from "@snapcook/schema";
import { latest, save } from "./store";

/** Reads reference recipes on the web and stores the consensus. Skips a dish that has notes. */
export async function research(db: Db, llm: Llm, config: PipelineConfig, dish: DishCandidate) {
  if (await latest(db, dish.id, "research", ResearchNotes)) return "skipped";
  const notes = await llm.structured(
    {
      system: config.research.system,
      prompt: [
        `Dish: ${dish.name}`,
        dish.aliases.length > 0 ? `Also known as: ${dish.aliases.join(", ")}` : "",
        `Cuisine: ${dish.cuisine}`,
      ]
        .filter(Boolean)
        .join("\n"),
      web: true,
    },
    ResearchNotes,
    { endpoint: "corpus.research", household_id: null, role: "write" },
  );
  await save(db, dish.id, "research", notes);
  return "done";
}
