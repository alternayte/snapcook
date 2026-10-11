import { type Db, schema } from "@snapcook/db";
import type { DishCandidate, PipelineStage } from "@snapcook/schema";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { z } from "zod";

const { dishCandidates, dishStageOutputs } = schema;

/** The newest output of a stage for a dish, parsed, or undefined when the stage has not run. */
export async function latest<S extends z.ZodType>(
  db: Db,
  candidateId: string,
  stage: PipelineStage,
  shape: S,
): Promise<{ attempt: number; value: z.infer<S> } | undefined> {
  const [row] = await db
    .select()
    .from(dishStageOutputs)
    .where(and(eq(dishStageOutputs.candidate_id, candidateId), eq(dishStageOutputs.stage, stage)))
    .orderBy(desc(dishStageOutputs.attempt))
    .limit(1);
  return row ? { attempt: row.attempt, value: shape.parse(row.payload) } : undefined;
}

/**
 * Stores a stage's output for a dish. The write stage takes the next attempt number. Every later
 * stage passes the attempt of the draft it worked on, so a result is tied to one draft.
 */
export async function save(
  db: Db,
  candidateId: string,
  stage: PipelineStage,
  payload: object,
  attempt?: number,
) {
  let next = attempt;
  if (next === undefined) {
    const [last] = await db
      .select({ attempt: dishStageOutputs.attempt })
      .from(dishStageOutputs)
      .where(and(eq(dishStageOutputs.candidate_id, candidateId), eq(dishStageOutputs.stage, stage)))
      .orderBy(desc(dishStageOutputs.attempt))
      .limit(1);
    next = (last?.attempt ?? 0) + 1;
  }
  const row = {
    candidate_id: candidateId,
    stage,
    attempt: next,
    payload: payload as Record<string, unknown>,
  };
  await db
    .insert(dishStageOutputs)
    .values(row)
    .onConflictDoUpdate({
      target: [dishStageOutputs.candidate_id, dishStageOutputs.stage, dishStageOutputs.attempt],
      set: { payload: row.payload },
    });
}

export type Selection = { batch?: number; dish?: string; limit?: number };

/** The dishes a stage run covers: those in a writing batch, narrowed by the selection. */
export async function selectedDishes(db: Db, selection: Selection): Promise<DishCandidate[]> {
  const rows = await db
    .select()
    .from(dishCandidates)
    .where(
      and(
        isNotNull(dishCandidates.batch),
        selection.batch === undefined ? undefined : eq(dishCandidates.batch, selection.batch),
        selection.dish === undefined ? undefined : eq(dishCandidates.name, selection.dish),
      ),
    )
    .orderBy(asc(dishCandidates.batch), asc(dishCandidates.cuisine), asc(dishCandidates.name));
  return rows;
}
