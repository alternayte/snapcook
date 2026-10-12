import { Location, type MergeChoice } from "@snapcook/schema";
import { Link } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ItemRow } from "@/components/pantry/item-row";
import { Card, Label, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import {
  type AddOutcome,
  useAddPantryItem,
  useChangePantryItem,
  useIngredientSearch,
  useMe,
  usePantry,
  useRemovePantryItem,
} from "@/lib/queries";
import { useT } from "@/lib/use-t";

// The part of the typed text that is a name: what is left when the amount is taken out.
const AMOUNT = /(?:\d+(?:[.,/]\d+)?|[½¼¾])\s*(?:kg|g|ml|cl|dl|l|x|tbsp|tsp|cups?)?(?=\s|$)/gi;
const namePart = (text: string) => text.replace(AMOUNT, " ").replace(/\s+/g, " ").trim();

const MERGES: MergeChoice[] = ["add", "replace", "separate"];

function Pantry({ householdId }: { householdId: string }) {
  const t = useT();
  const pantry = usePantry(householdId);
  const add = useAddPantryItem(householdId);
  const change = useChangePantryItem(householdId);
  const remove = useRemovePantryItem(householdId);
  const [text, setText] = useState("");
  const [location, setLocation] = useState<Location>("fridge");
  const [pending, setPending] = useState<Extract<AddOutcome, { outcome: "merge_needed" }>>();
  const name = namePart(text);
  const search = useIngredientSearch(name);
  const suggestions = (search.data ?? []).filter((s) => s.name !== name.toLowerCase()).slice(0, 5);

  async function submit(merge?: MergeChoice) {
    const outcome = await add.mutateAsync({ text: text.trim(), location, merge });
    if (outcome.outcome === "merge_needed") return setPending(outcome);
    setPending(undefined);
    setText("");
  }

  if (pantry.isPending) return <Loading />;
  if (pantry.isError) return <Failed onRetry={() => pantry.refetch()} />;

  return (
    <Page>
      <View className="h-20">
        <Label>
          <Text variant="label">{t("tabs.pantry")}</Text>
        </Label>
        <Sticker
          name="lemon"
          size={84}
          angle={10}
          delay={150}
          style={{ position: "absolute", right: 4, top: -4 }}
        />
        <Sticker
          name="chilli"
          size={56}
          angle={-24}
          delay={300}
          style={{ position: "absolute", right: 84, top: 30 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("pantry.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("pantry.note")}
        </Text>
      </View>

      <Link href="/snap" asChild>
        <Button>
          <Text>{t("pantry.snap")}</Text>
        </Button>
      </Link>

      <Card tape tilt={-0.6} className="gap-3 pt-6">
        <Field
          label={t("pantry.add.label")}
          placeholder={t("pantry.add.placeholder")}
          value={text}
          onChangeText={(next) => {
            setText(next);
            setPending(undefined);
          }}
          onSubmitEditing={() => (text.trim() ? submit() : undefined)}
          returnKeyType="done"
          error={add.isError ? t("common.error") : undefined}
        />
        {suggestions.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {suggestions.map((s, index) => (
              <Chip
                key={s.id}
                index={index}
                selected={false}
                label={s.name}
                onPress={() => setText(name === "" ? s.name : text.replace(name, s.name))}
              />
            ))}
          </View>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {Location.options.map((option, index) => (
            <Chip
              key={option}
              index={index}
              label={t(`location.${option}`)}
              selected={location === option}
              onPress={() => setLocation(option)}
            />
          ))}
        </View>
        {pending ? (
          <View className="gap-3 rounded-paper bg-paper p-3">
            <Text variant="strong">
              {t("pantry.merge.title", {
                name: pending.existing.display_name,
                location: t(`location.${pending.existing.location}`).toLowerCase(),
              })}
            </Text>
            <View className="flex-row flex-wrap gap-3">
              {MERGES.map((choice) => (
                <Button
                  key={choice}
                  variant="paper"
                  size="sm"
                  className="self-auto"
                  disabled={add.isPending}
                  onPress={() => submit(choice)}
                >
                  <Text>{t(`pantry.merge.${choice}`)}</Text>
                </Button>
              ))}
            </View>
          </View>
        ) : (
          <Button
            variant="paper"
            disabled={text.trim() === "" || add.isPending}
            onPress={() => submit()}
          >
            <Text>{t("pantry.add.submit")}</Text>
          </Button>
        )}
      </Card>

      {pantry.data.length === 0 ? (
        <Text variant="hand" className="text-center">
          {t("pantry.empty")}
        </Text>
      ) : (
        Location.options
          .map((place) => ({ place, items: pantry.data.filter((item) => item.location === place) }))
          .filter((group) => group.items.length > 0)
          .map((group, index) => (
            <Card
              key={group.place}
              tilt={index % 2 === 0 ? 0.5 : -0.5}
              delay={index * 160}
              className="gap-1"
            >
              <Label className={index % 2 === 0 ? "bg-mustard" : "bg-sage"}>
                <Text variant="label">{t(`location.${group.place}`)}</Text>
              </Label>
              {group.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onChange={(patch) => change.mutate({ id: item.id, patch })}
                  onRemove={() => remove.mutate(item.id)}
                />
              ))}
            </Card>
          ))
      )}
    </Page>
  );
}

export default function PantryScreen() {
  const me = useMe();
  const household = me.data?.household;
  return household ? <Pantry householdId={household.id} /> : <Loading />;
}
