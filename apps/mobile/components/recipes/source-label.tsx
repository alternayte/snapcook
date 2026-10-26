import type { RecipeSource } from "@snapcook/schema";
import { Label } from "@/components/scrap/paper";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/use-t";

const PAPER: Record<RecipeSource, string> = {
  official: "bg-paper-deep",
  community: "bg-mustard",
  household: "bg-sage",
};

/** Who wrote the recipe, as a label-maker tag: the app, the community, or this household. */
export function SourceLabel({ source }: { source: RecipeSource }) {
  const t = useT();
  return (
    <Label className={PAPER[source]}>
      <Text variant="label">{t(`source.${source}`)}</Text>
    </Label>
  );
}
