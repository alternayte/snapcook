import { z } from "zod";

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
