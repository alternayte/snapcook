import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAddMissing } from "@/lib/recipes";
import { useT } from "@/lib/use-t";

type Props = {
  householdId: string;
  recipeId: string;
  /** The fitted recipe, when there is one: its amounts and swaps count. */
  adaptationId?: string;
  variant?: "paper" | "quiet";
};

/** One tap puts on the list everything the recipe needs that the pantry lacks. */
export function AddMissing({ householdId, recipeId, adaptationId, variant = "paper" }: Props) {
  const t = useT();
  const add = useAddMissing(householdId);
  if (add.isSuccess) {
    return (
      <Text className="font-bold text-sm text-ink-soft">
        ✓ {add.data.added > 0 ? t("missing.added") : t("missing.none")}
      </Text>
    );
  }
  return (
    <Button
      variant={variant}
      size="sm"
      className="self-start"
      disabled={add.isPending}
      onPress={() => add.mutate({ recipe_id: recipeId, adaptation_id: adaptationId })}
    >
      <Text>{add.isError ? t("common.retry") : t("missing.add")}</Text>
    </Button>
  );
}
