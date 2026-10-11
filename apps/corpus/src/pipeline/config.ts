import { z } from "zod";

const Prompt = z.object({ system: z.string().min(1) });

/** The private file that holds the pipeline's prompt text and limits. */
export const PipelineConfig = z.object({
  /** The only tags a recipe may carry. */
  tags: z.array(z.string().min(1)).min(1),
  /** Plausible grams per serving for the summed ingredients of some categories. */
  bands: z.array(
    z.object({
      label: z.string().min(1),
      categories: z.array(z.string().min(1)).min(1),
      /** Which ingredient roles count toward the sum. */
      roles: z.array(z.string().min(1)).min(1),
      /** The band applies only to dishes with one of these primary proteins. Empty means all. */
      dish_proteins: z.array(z.string().min(1)),
      /** The band applies only to dishes of one of these types. Empty means all. */
      dish_types: z.array(z.string().min(1)),
      min_g: z.number().nonnegative(),
      max_g: z.number().positive(),
    }),
  ),
  research: Prompt,
  write: Prompt,
  device: Prompt,
  review: Prompt,
});
export type PipelineConfig = z.infer<typeof PipelineConfig>;

export async function loadPipelineConfig(path: string) {
  return PipelineConfig.parse(await Bun.file(path).json());
}
