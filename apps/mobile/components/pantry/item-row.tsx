import { Location, type PantryItem, type PantryPatch, type Unit } from "@snapcook/schema";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/use-t";

// One press of a stepper, by unit: one of a counted thing, 50 g, 100 ml.
const STEP: Record<Unit, number> = { piece: 1, g: 50, ml: 100, tbsp: 1, tsp: 1, cup: 1 };
// The units offered when an item has no quantity yet.
const FIRST_UNITS: Unit[] = ["piece", "g", "ml"];

type Props = {
  item: PantryItem;
  onChange: (patch: PantryPatch) => void;
  onRemove: () => void;
};

/** One thing in the pantry. Tap it to open its controls. */
export function ItemRow({ item, onChange, onRemove }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { quantity, unit, display_name: name } = item;
  const amount =
    quantity === null || unit === null
      ? t("pantry.some")
      : unit === "piece"
        ? t("pantry.unit.piece", { quantity })
        : t("pantry.unit.other", { quantity, unit });
  const step = (direction: 1 | -1) => {
    if (quantity === null || unit === null) return;
    const next = Math.max(0, Math.round((quantity + direction * STEP[unit]) * 100) / 100);
    onChange({ quantity: next, unit });
  };

  return (
    <View className="border-b border-b-hairline border-ink/30 py-2.5">
      <View className="flex-row items-center gap-3">
        <Pressable className="flex-1" onPress={() => setOpen(!open)} aria-expanded={open}>
          <Text variant="strong">{name}</Text>
          {item.use_soon ? (
            <Text className="font-hand text-lg text-tomato">{t("pantry.useSoon")}</Text>
          ) : null}
        </Pressable>
        {quantity !== null && unit !== null ? (
          <Button
            variant="paper"
            size="sm"
            className="self-auto"
            onPress={() => step(-1)}
            aria-label={t("pantry.less", { name })}
          >
            <Text>−</Text>
          </Button>
        ) : null}
        <Text variant="strong" className="min-w-14 text-center">
          {amount}
        </Text>
        {quantity !== null && unit !== null ? (
          <Button
            variant="paper"
            size="sm"
            className="self-auto"
            onPress={() => step(1)}
            aria-label={t("pantry.more", { name })}
          >
            <Text>+</Text>
          </Button>
        ) : null}
      </View>
      {open ? (
        <View className="gap-3 pb-1 pt-3">
          {quantity === null ? (
            <View className="flex-row flex-wrap gap-2">
              {FIRST_UNITS.map((first, index) => (
                <Chip
                  key={first}
                  index={index}
                  selected={false}
                  label={`${STEP[first]} ${first === "piece" ? "×" : first}`}
                  onPress={() => onChange({ quantity: STEP[first], unit: first })}
                />
              ))}
            </View>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {Location.options.map((location, index) => (
              <Chip
                key={location}
                index={index}
                label={t(`location.${location}`)}
                selected={item.location === location}
                onPress={() => onChange({ location })}
              />
            ))}
          </View>
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Chip
              label={t("pantry.useSoon")}
              selected={item.use_soon}
              onPress={() => onChange({ use_soon: !item.use_soon })}
            />
            <Button variant="quiet" size="sm" className="self-auto" onPress={onRemove}>
              <Text>{t("pantry.remove", { name })}</Text>
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
