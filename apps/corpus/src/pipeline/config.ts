import { z } from "zod";

const Prompt = z.object({ system: z.string().min(1) });

/** The private file that holds the pipeline's prompt text and limits. */
export const PipelineConfig = z.object({
  /** The only tags a recipe may carry. */
  tags: z.array(z.string().min(1)).min(1),
  research: Prompt,
  write: Prompt,
  device: Prompt,
  review: Prompt,
});
export type PipelineConfig = z.infer<typeof PipelineConfig>;

export async function loadPipelineConfig(path: string) {
  return PipelineConfig.parse(await Bun.file(path).json());
}
