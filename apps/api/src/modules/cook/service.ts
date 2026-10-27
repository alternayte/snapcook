import { type Db, schema } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import {
  type CookView,
  convert,
  type FinishCookInput,
  type FinishCookResponse,
  type Household,
  type HouseholdProfile,
  type RemovedItem,
  type RescueResponse,
} from "@snapcook/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { AllowanceUsedUp, consume } from "../billing/usage";
import { drawDown } from "./drawdown";

const {
  adaptations,
  cookSessions,
  ingredients,
  pantryItems,
  recipeImages,
  recipeReports,
  recipeVersions,
  users,
} = schema;

// A rating at or below this, or any note, is worth a person's look at the recipe.
const LOW_RATING = 2;
// At or above this cosine, a question is taken to be about a known way the dish goes wrong.
const KNOWN_FIX_MIN_SIMILARITY = 0.8;
const RESCUE_MAX_WORDS = 120;
const HISTORY_LIMIT = 200;

const sessionWith = (db: Db) =>
  db
    .select({
      session: cookSessions,
      output: adaptations.output,
      recipe_version_id: adaptations.recipe_version_id,
      recipe_id: recipeVersions.recipe_id,
      title: recipeVersions.title,
      failure_modes: recipeVersions.failure_modes,
      image: recipeImages.file,
    })
    .from(cookSessions)
    .innerJoin(adaptations, eq(adaptations.id, cookSessions.adaptation_id))
    .innerJoin(recipeVersions, eq(recipeVersions.id, adaptations.recipe_version_id))
    .leftJoin(recipeImages, eq(recipeImages.recipe_version_id, recipeVersions.id));

/** One cook of this household, with the recipe as it was cooked and the pantry items it touches. */
export async function cookView(
  db: Db,
  householdId: string,
  id: string,
): Promise<CookView | undefined> {
  const [row] = await sessionWith(db).where(
    and(eq(cookSessions.household_id, householdId), eq(cookSessions.id, id)),
  );
  if (!row) return undefined;
  const itemIds = row.output.ingredients.flatMap((i) =>
    i.pantry_item_id ? [i.pantry_item_id] : [],
  );
  const held =
    itemIds.length === 0
      ? []
      : await db
          .select()
          .from(pantryItems)
          .where(and(eq(pantryItems.household_id, householdId), inArray(pantryItems.id, itemIds)));
  return {
    id: row.session.id,
    recipe_id: row.recipe_id,
    recipe_version_id: row.recipe_version_id,
    title: row.title,
    image: row.image,
    started_at: row.session.started_at,
    finished_at: row.session.finished_at,
    current_step: row.session.current_step,
    rating: row.session.rating,
    recipe: row.output,
    confirm_still_have: held
      .filter((item) => item.quantity === null)
      .map((item) => ({ pantry_item_id: item.id, display_name: item.display_name })),
    items: Object.fromEntries(
      held.map((item) => [
        item.id,
        { display_name: item.display_name, quantity: item.quantity, unit: item.unit },
      ]),
    ),
  };
}

/** Starts a cook of one of the household's own adaptations. */
export async function startCook(db: Db, householdId: string, userId: string, adaptationId: string) {
  const [adaptation] = await db
    .select({ id: adaptations.id })
    .from(adaptations)
    .where(and(eq(adaptations.household_id, householdId), eq(adaptations.id, adaptationId)));
  if (!adaptation) return undefined;
  const [session] = await db
    .insert(cookSessions)
    .values({ household_id: householdId, user_id: userId, adaptation_id: adaptationId })
    .returning({ id: cookSessions.id });
  return session ? cookView(db, householdId, session.id) : undefined;
}

export async function setStep(db: Db, householdId: string, id: string, current_step: number) {
  const moved = await db
    .update(cookSessions)
    .set({ current_step })
    .where(and(eq(cookSessions.household_id, householdId), eq(cookSessions.id, id)))
    .returning({ id: cookSessions.id });
  return moved.length > 0;
}

/**
 * Ends a cook and takes what it used out of the pantry, in one transaction. Ending the same cook
 * again changes nothing and returns what was applied the first time.
 */
export async function finishCook(
  db: Db,
  householdId: string,
  profile: HouseholdProfile,
  id: string,
  input: FinishCookInput,
): Promise<FinishCookResponse | undefined> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ session: cookSessions, recipe_version_id: adaptations.recipe_version_id })
      .from(cookSessions)
      .innerJoin(adaptations, eq(adaptations.id, cookSessions.adaptation_id))
      .where(and(eq(cookSessions.household_id, householdId), eq(cookSessions.id, id)))
      .for("update", { of: cookSessions });
    if (!row) return undefined;
    if (row.session.finished_at) {
      return { outcome: "finished", applied: row.session.deductions ?? [], used_up: [] };
    }

    // The rows are locked, so an edit by another member waits and then applies on the new amount.
    const touched = [...new Set([...input.deductions.map((d) => d.pantry_item_id), ...input.gone])];
    const held =
      touched.length === 0
        ? []
        : await tx
            .select()
            .from(pantryItems)
            .where(and(eq(pantryItems.household_id, householdId), inArray(pantryItems.id, touched)))
            .for("update");
    const facts = await tx
      .select({
        id: ingredients.id,
        grams_per_unit: ingredients.grams_per_unit,
        ml_per_unit: ingredients.ml_per_unit,
      })
      .from(ingredients)
      .where(
        inArray(
          ingredients.id,
          held.flatMap((item) => (item.ingredient_id ? [item.ingredient_id] : [])),
        ),
      );
    const result = drawDown(
      input.deductions,
      new Map(held.map((item) => [item.id, item])),
      new Map(facts.map((f) => [f.id, f])),
      new Set(profile.staples),
    );
    if (result.needsInput.length > 0) {
      return { outcome: "needs_input", needs_input: result.needsInput };
    }

    const now = new Date();
    for (const change of result.update) {
      await tx
        .update(pantryItems)
        .set({ quantity: change.quantity, source: "draw_down", updated_at: now })
        .where(eq(pantryItems.id, change.id));
    }
    // Only an item kept as "some" can be reported gone by hand; one with an amount is counted.
    const gone = held.filter((item) => input.gone.includes(item.id) && item.quantity === null);
    const removed = [...result.remove, ...gone];
    if (removed.length > 0) {
      await tx.delete(pantryItems).where(
        inArray(
          pantryItems.id,
          removed.map((item) => item.id),
        ),
      );
    }
    await tx
      .update(cookSessions)
      .set({
        deductions: result.applied,
        removed_items: removed.map(
          (item): RemovedItem => ({
            id: item.id,
            ingredient_id: item.ingredient_id,
            display_name: item.display_name,
            quantity: item.quantity,
            unit: item.unit,
            location: item.location,
            use_soon: item.use_soon,
            expires_on: item.expires_on,
          }),
        ),
        finished_at: now,
        rating: input.rating ?? null,
        notes: input.notes || null,
      })
      .where(eq(cookSessions.id, id));
    if ((input.rating !== undefined && input.rating <= LOW_RATING) || input.notes) {
      await tx.insert(recipeReports).values({
        recipe_version_id: row.recipe_version_id,
        household_id: householdId,
        kind: "rating",
        payload: { cook_session_id: id, rating: input.rating ?? null, notes: input.notes ?? null },
      });
    }
    return {
      outcome: "finished",
      applied: result.applied,
      used_up: removed.map((item) => ({
        ingredient_id: item.ingredient_id,
        display_name: item.display_name,
      })),
    };
  });
}

/** The household's cooks, newest first, with who cooked and whether the machine was used. */
export async function cookHistory(db: Db, householdId: string) {
  const rows = await db
    .select({
      session: cookSessions,
      output: adaptations.output,
      controls: adaptations.controls,
      recipe_id: recipeVersions.recipe_id,
      title: recipeVersions.title,
      image: recipeImages.file,
      cook: users.name,
    })
    .from(cookSessions)
    .innerJoin(adaptations, eq(adaptations.id, cookSessions.adaptation_id))
    .innerJoin(recipeVersions, eq(recipeVersions.id, adaptations.recipe_version_id))
    .leftJoin(recipeImages, eq(recipeImages.recipe_version_id, recipeVersions.id))
    .leftJoin(users, eq(users.id, cookSessions.user_id))
    .where(eq(cookSessions.household_id, householdId))
    .orderBy(desc(cookSessions.started_at))
    .limit(HISTORY_LIMIT);
  return rows.map((row) => ({
    id: row.session.id,
    recipe_id: row.recipe_id,
    title: row.title,
    image: row.image,
    started_at: row.session.started_at,
    finished_at: row.session.finished_at,
    rating: row.session.rating,
    servings: row.output.servings,
    cook: row.cook,
    machine: row.controls.device_profile_id !== null,
  }));
}

/** What removing a finished cook puts back into the pantry, by pantry item. */
export async function restoreList(db: Db, householdId: string, id: string) {
  const [row] = await db
    .select({ session: cookSessions })
    .from(cookSessions)
    .where(and(eq(cookSessions.household_id, householdId), eq(cookSessions.id, id)));
  if (!row) return undefined;
  const removed = new Map((row.session.removed_items ?? []).map((item) => [item.id, item]));
  const ids = (row.session.deductions ?? []).map((d) => d.pantry_item_id);
  const held =
    ids.length === 0
      ? []
      : await db
          .select({ id: pantryItems.id, display_name: pantryItems.display_name })
          .from(pantryItems)
          .where(and(eq(pantryItems.household_id, householdId), inArray(pantryItems.id, ids)));
  const names = new Map(held.map((item) => [item.id, item.display_name]));
  return [
    ...(row.session.deductions ?? [])
      .filter((d) => d.quantity > 0)
      .map((d) => ({
        display_name:
          names.get(d.pantry_item_id) ?? removed.get(d.pantry_item_id)?.display_name ?? "",
        quantity: d.quantity as number | null,
        unit: d.unit as RemovedItem["unit"],
      })),
    // A "some" item the cook used up comes back with no amount.
    ...[...removed.values()]
      .filter((item) => item.quantity === null)
      .map((item) => ({ display_name: item.display_name, quantity: null, unit: null })),
  ].filter((line) => line.display_name !== "");
}

/**
 * Removes a cook. With `restore`, everything its finish took from the pantry goes back: amounts
 * are added to the items that are still there, and items it used up are made again. One
 * transaction, so a removal never half-applies.
 */
export async function removeCook(db: Db, householdId: string, id: string, restore: boolean) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ session: cookSessions })
      .from(cookSessions)
      .where(and(eq(cookSessions.household_id, householdId), eq(cookSessions.id, id)))
      .for("update");
    if (!row) return false;
    if (restore && row.session.finished_at) {
      const removed = new Map((row.session.removed_items ?? []).map((item) => [item.id, item]));
      const deductions = row.session.deductions ?? [];
      const ids = [...new Set([...deductions.map((d) => d.pantry_item_id), ...removed.keys()])];
      const held =
        ids.length === 0
          ? []
          : await tx
              .select()
              .from(pantryItems)
              .where(and(eq(pantryItems.household_id, householdId), inArray(pantryItems.id, ids)))
              .for("update");
      const facts = await tx
        .select({
          id: ingredients.id,
          grams_per_unit: ingredients.grams_per_unit,
          ml_per_unit: ingredients.ml_per_unit,
        })
        .from(ingredients)
        .where(
          inArray(
            ingredients.id,
            [...held, ...removed.values()].flatMap((item) =>
              item.ingredient_id ? [item.ingredient_id] : [],
            ),
          ),
        );
      const conversions = new Map(facts.map((f) => [f.id, f]));
      const now = new Date();
      for (const item of held) {
        const deduction = deductions.find((d) => d.pantry_item_id === item.id);
        if (!deduction || item.quantity === null || item.unit === null) continue;
        const facts = item.ingredient_id ? conversions.get(item.ingredient_id) : undefined;
        const back =
          deduction.unit === item.unit
            ? deduction.quantity
            : facts
              ? convert(deduction.quantity, deduction.unit, item.unit, facts)
              : null;
        // The item was changed to a unit with no conversion since: its amount is left alone.
        if (back === null) continue;
        await tx
          .update(pantryItems)
          .set({ quantity: Math.round((item.quantity + back) * 100) / 100, updated_at: now })
          .where(eq(pantryItems.id, item.id));
      }
      const gone = [...removed.values()].filter((item) => !held.some((h) => h.id === item.id));
      if (gone.length > 0) {
        await tx
          .insert(pantryItems)
          .values(
            gone.map((item) => ({ ...item, household_id: householdId, source: "manual" as const })),
          );
      }
    }
    await tx.delete(cookSessions).where(eq(cookSessions.id, id));
    return true;
  });
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const RESCUE_SYSTEM = [
  "A home cook is in the middle of a recipe and something has gone wrong. You get the dish, the step they are on, and what they see.",
  `Say what to do now, in plain words, in at most ${RESCUE_MAX_WORDS} words. Give one clear action first, then how to tell it has worked.`,
  "Stay with this dish and these ingredients. If the food may be unsafe to eat, say so plainly. Do not guess at facts you were not given.",
  "Write in British English.",
].join(" ");

/**
 * Answers "something's off". A question that matches one of the dish's known failures gets the
 * stored fix; any other goes to the cheap model. Every exchange is kept for corpus review.
 */
export async function rescue(
  db: Db,
  llm: Llm,
  household: Pick<Household, "id" | "plan">,
  id: string,
  input: { step_index: number; text: string },
): Promise<RescueResponse | undefined> {
  const householdId = household.id;
  const [row] = await sessionWith(db).where(
    and(eq(cookSessions.household_id, householdId), eq(cookSessions.id, id)),
  );
  if (!row) return undefined;
  const refusal = await consume(db, household, "rescues");
  if (refusal) throw new AllowanceUsedUp(refusal);
  const ctx = { endpoint: "cooks.rescue", household_id: householdId };
  const symptoms = row.failure_modes.map((mode) => mode.symptom);
  const [question, ...known] = await llm.embed([input.text, ...symptoms], ctx);
  const scored = known.map((vector, i) => ({
    i,
    similarity: question ? cosine(question, vector) : 0,
  }));
  const best = scored.sort((a, b) => b.similarity - a.similarity)[0];
  const fix =
    best && best.similarity >= KNOWN_FIX_MIN_SIMILARITY ? row.failure_modes[best.i] : undefined;

  let answer: RescueResponse;
  if (fix) {
    answer = { answer: fix.fix, source: "known_fix" };
  } else {
    const step = row.output.steps[input.step_index];
    const reply = await llm.structured(
      {
        system: RESCUE_SYSTEM,
        prompt: [
          `Dish: ${row.title}, ${row.output.servings} servings.`,
          `Ingredients: ${row.output.ingredients.map((i) => i.display).join(", ")}.`,
          `Step ${input.step_index + 1} of ${row.output.steps.length}: ${step?.text ?? "unknown"}`,
          `What the cook sees: ${input.text}`,
        ].join("\n"),
      },
      z.object({ answer: z.string().min(1) }),
      { ...ctx, role: "vision" },
    );
    answer = {
      answer: reply.answer.split(/\s+/).slice(0, RESCUE_MAX_WORDS).join(" "),
      source: "model",
    };
  }
  await db.insert(recipeReports).values({
    recipe_version_id: row.recipe_version_id,
    household_id: householdId,
    kind: "rescue",
    payload: { cook_session_id: id, ...input, ...answer },
  });
  return answer;
}
