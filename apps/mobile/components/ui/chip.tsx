import { Pressable } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type ChipProps = { label: string; selected: boolean; onPress: () => void; index?: number };

/** A paper tag that is on or off. Alternate tags lean opposite ways. */
export function Chip({ label, selected, onPress, index = 0 }: ChipProps) {
  return (
    <Pressable
      role="checkbox"
      aria-checked={selected}
      onPress={onPress}
      className={cn(
        "min-h-10 justify-center rounded-full border-ink border-ink px-3.5",
        selected ? "bg-sage" : "bg-card",
      )}
      style={{ transform: [{ rotate: index % 2 === 0 ? "-1.5deg" : "1deg" }] }}
    >
      <Text className="font-medium text-sm">{label}</Text>
    </Pressable>
  );
}
