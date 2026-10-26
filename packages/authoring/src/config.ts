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
  /**
   * The share of an ingredient's weight that is eaten, by canonical name, for ingredients sold
   * with shell or bone. The bands count only this share.
   */
  edible_share: z.record(z.string(), z.number().positive().max(1)),
  research: Prompt,
  write: Prompt,
  device: Prompt,
  review: Prompt,
});
export type PipelineConfig = z.infer<typeof PipelineConfig>;

export async function loadPipelineConfig(path: string) {
  return PipelineConfig.parse(await Bun.file(path).json());
}

/** The private file that holds the house style of the recipe pictures and the check's wording. */
export const ImageConfig = z.object({
  /** The photographer's brief every picture shares. */
  style: z.string().min(1),
  /** Camera angle by dish type. `default` covers the rest. */
  angles: z.record(z.string(), z.string().min(1)).refine((a) => "default" in a, {
    message: "angles needs a default",
  }),
  /** What must not be in the frame. */
  forbid: z.string().min(1),
  /** Instructions for the model that inspects a picture. */
  check: z.string().min(1),
});
export type ImageConfig = z.infer<typeof ImageConfig>;

export async function loadImageConfig(path: string) {
  return ImageConfig.parse(await Bun.file(path).json());
}
