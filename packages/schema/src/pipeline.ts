import { z } from "zod";
import { DeviceStep, FailureMode } from "./corpus";
import { Id, IngredientRole, Quantity, Suitability, Unit } from "./enums";

export const PipelineStage = z.enum(["research", "write", "device", "validate", "review"]);
export type PipelineStage = z.infer<typeof PipelineStage>;

/** What research found about a dish. Paraphrased: no source text is kept. */
export const ResearchNotes = z.object({
  references: z.array(z.object({ url: z.url(), title: z.string().min(1) })).min(1),
  ingredients: z.array(
    z.object({
      name: z.string().min(1),
      amount_for_four: z.string().min(1),
      role: IngredientRole,
    }),
  ),
  method: z.string().min(1),
  time_total_min: z.number().int().positive(),
  time_active_min: z.number().int().positive(),
  pitfalls: z.array(z.string().min(1)),
});
export type ResearchNotes = z.infer<typeof ResearchNotes>;

export const DraftIngredient = z.object({
  /** A canonical ingredient name from the list the writer was given. */
  ingredient: z.string().min(1),
  quantity: Quantity.nullable(),
  unit: Unit.nullable(),
  prep: z.string().nullable(),
  role: IngredientRole,
  /** Canonical names that can stand in for a core ingredient. */
  substitutes: z.array(z.string().min(1)),
});
export type DraftIngredient = z.infer<typeof DraftIngredient>;

/** A recipe as the writer returns it, before its ingredients are matched to ids. */
export const RecipeDraft = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  time_total_min: z.number().int().positive(),
  time_active_min: z.number().int().positive(),
  difficulty: z.number().int().min(1).max(3),
  ingredients: z.array(DraftIngredient).min(1),
  steps: z.array(DeviceStep).min(1),
  tags: z.array(z.string().min(1)),
  failure_modes: z.array(FailureMode),
});
export type RecipeDraft = z.infer<typeof RecipeDraft>;

export const DeviceVariantDraft = z.object({
  suitability: Suitability,
  /** Why the dish suits the device, suits it in part, or does not. */
  notes: z.string().min(1),
  steps: z.array(DeviceStep),
});
export type DeviceVariantDraft = z.infer<typeof DeviceVariantDraft>;

export const ValidationReport = z.object({
  problems: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) })),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

export const ReviewVerdict = z.object({
  verdict: z.enum(["pass", "fix", "reject"]),
  reasons: z.array(z.string().min(1)),
  /** What to change, when the verdict is `fix`. */
  fixes: z.array(z.string().min(1)),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

/** One stage's result for one dish. A later attempt supersedes an earlier one. */
export const DishStageOutput = z.object({
  id: Id,
  candidate_id: Id,
  stage: PipelineStage,
  attempt: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.date(),
});
export type DishStageOutput = z.infer<typeof DishStageOutput>;
