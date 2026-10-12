import type { ListAddItem } from "@snapcook/schema";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAddToList } from "@/lib/list";
import { useT } from "@/lib/use-t";

type Props = {
  householdId: string;
  items: ListAddItem[];
  label?: string;
  variant?: "paper" | "quiet";
};

/** Puts lines on the shopping list and then says they are there. */
export function AddToList({ householdId, items, label, variant = "quiet" }: Props) {
  const t = useT();
  const add = useAddToList(householdId);
  if (add.isSuccess) {
    return <Text className="font-bold text-sm text-ink-soft">✓ {t("list.added")}</Text>;
  }
  return (
    <Button
      variant={variant}
      size="sm"
      className="self-start"
      disabled={add.isPending || items.length === 0}
      onPress={() => add.mutate(items)}
    >
      <Text>{add.isError ? t("common.retry") : (label ?? t("list.addTo"))}</Text>
    </Button>
  );
}
