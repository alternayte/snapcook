import { type Location, MergeChoice, type Unit } from "@snapcook/schema";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/use-t";
import { cn } from "@/lib/utils";

/** Below this, a proposal is a guess: it starts unticked and is drawn fainter. */
export const SURE_ENOUGH = 0.6;

export type Row = {
  key: string;
  name: string;
  ingredient_id: string | null;
  quantity: number | null;
  unit: Unit | null;
  location: Location;
  confidence: number;
  existing_item_id: string | null;
  accepted: boolean;
  merge: MergeChoice;
};

const UNITS: Unit[] = ["piece", "g", "ml"];

type Props = { row: Row; onChange: (patch: Partial<Row>) => void };

/** One thing the photo seems to show. The household ticks it, fixes it or leaves it out. */
export function ProposalRow({ row, onChange }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const amount =
    row.quantity === null || row.unit === null
      ? t("snap.row.noAmount")
      : row.unit === "piece"
        ? String(row.quantity)
        : `${row.quantity} ${row.unit}`;

  return (
    <View
      className={cn(
        "gap-2 border-b border-b-hairline border-ink/30 py-2.5",
        row.confidence < SURE_ENOUGH && !row.accepted && "opacity-60",
      )}
    >
      <View className="flex-row items-center gap-3">
        <Pressable
          role="checkbox"
          aria-checked={row.accepted}
          aria-label={row.name}
          onPress={() => onChange({ accepted: !row.accepted })}
          className={cn(
            "h-7 w-7 items-center justify-center rounded border-bold border-ink",
            row.accepted ? "bg-sage" : "bg-card",
          )}
        >
          {row.accepted ? <Text className="font-bold text-base leading-5">✓</Text> : null}
        </Pressable>
        <Pressable
          className="flex-1"
          onPress={() => setEditing(!editing)}
          aria-label={t("snap.row.edit", { name: row.name })}
        >
          <Text variant="strong">{row.name}</Text>
        </Pressable>
        <Text variant="strong">{amount}</Text>
      </View>
      {row.existing_item_id && row.accepted ? (
        <View className="flex-row flex-wrap items-center gap-2 pl-10">
          <Text variant="small">{t("snap.row.have")}</Text>
          {MergeChoice.options.map((choice, index) => (
            <Chip
              key={choice}
              index={index}
              label={t(`pantry.merge.${choice}`)}
              selected={row.merge === choice}
              onPress={() => onChange({ merge: choice })}
            />
          ))}
        </View>
      ) : null}
      {editing ? (
        <View className="gap-3 pb-1 pl-10">
          {/* A corrected name is the person's own word, so the old match no longer applies. */}
          <Field
            label={t("snap.row.name")}
            value={row.name}
            onChangeText={(name) => onChange({ name, ingredient_id: null, existing_item_id: null })}
          />
          <Field
            label={t("snap.row.amount")}
            keyboardType="decimal-pad"
            value={row.quantity === null ? "" : String(row.quantity)}
            onChangeText={(text) => {
              const value = Number(text.replace(",", "."));
              onChange(
                text.trim() === "" || !Number.isFinite(value) || value < 0
                  ? { quantity: null, unit: null }
                  : { quantity: Math.round(value * 100) / 100, unit: row.unit ?? "piece" },
              );
            }}
          />
          {row.quantity !== null ? (
            <View className="flex-row flex-wrap gap-2">
              {UNITS.map((unit, index) => (
                <Chip
                  key={unit}
                  index={index}
                  label={unit === "piece" ? "×" : unit}
                  selected={row.unit === unit}
                  onPress={() => onChange({ unit })}
                />
              ))}
            </View>
          ) : null}
          <Button
            variant="paper"
            size="sm"
            className="self-start"
            onPress={() => setEditing(false)}
          >
            <Text>{t("snap.row.done")}</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}
