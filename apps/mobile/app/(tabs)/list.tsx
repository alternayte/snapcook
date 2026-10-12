import { Aisle, Location } from "@snapcook/schema";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Card, Label, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { amount } from "@/lib/format";
import { useAddToList, useChangeLine, useList, usePutAway, useRemoveLine } from "@/lib/list";
import { useMe } from "@/lib/queries";
import { useT } from "@/lib/use-t";
import { cn } from "@/lib/utils";

function List({ householdId }: { householdId: string }) {
  const t = useT();
  const list = useList(householdId);
  const add = useAddToList(householdId);
  const change = useChangeLine(householdId);
  const remove = useRemoveLine(householdId);
  const putAway = usePutAway(householdId);
  const [text, setText] = useState("");
  const [choosing, setChoosing] = useState(false);
  if (list.isPending) return <Loading />;
  if (list.isError) return <Failed onRetry={() => list.refetch()} />;
  const { items, recipes } = list.data;
  const bought = items.filter((item) => item.bought).length;

  const submit = () => {
    if (text.trim() === "") return;
    add.mutate([{ text: text.trim() }], { onSuccess: () => setText("") });
  };

  return (
    <Page>
      <View className="h-20">
        <Label>
          <Text variant="label">{t("tabs.list")}</Text>
        </Label>
        <Sticker
          name="lemon"
          size={80}
          angle={-12}
          delay={150}
          style={{ position: "absolute", right: 6, top: -4 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("list.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("list.note")}
        </Text>
      </View>

      <Card tape tilt={-0.6} className="gap-3 pt-6">
        <Field
          label={t("list.add.label")}
          placeholder={t("list.add.placeholder")}
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="done"
          error={add.isError ? t("common.error") : undefined}
        />
        <Button variant="paper" disabled={text.trim() === "" || add.isPending} onPress={submit}>
          <Text>{t("list.add.submit")}</Text>
        </Button>
      </Card>

      {items.length === 0 ? (
        <Text variant="hand" className="text-center">
          {t("list.empty")}
        </Text>
      ) : (
        Aisle.options
          .map((aisle) => ({ aisle, lines: items.filter((item) => item.aisle === aisle) }))
          .filter((group) => group.lines.length > 0)
          .map((group, index) => (
            <Card
              key={group.aisle}
              tilt={index % 2 === 0 ? 0.5 : -0.5}
              delay={index * 160}
              className="gap-1"
            >
              <Label className={index % 2 === 0 ? "bg-mustard" : "bg-sage"}>
                <Text variant="label">{t(`aisle.${group.aisle}`)}</Text>
              </Label>
              {group.lines.map((line) => {
                const wanted = line.wanted_by.flatMap((id) => recipes[id] ?? []);
                return (
                  <View
                    key={line.id}
                    className="flex-row items-center gap-3 border-b border-b-hairline border-ink/30 py-2.5"
                  >
                    <Pressable
                      role="checkbox"
                      aria-checked={line.bought}
                      aria-label={t("list.tick", { name: line.display_name })}
                      onPress={() =>
                        change.mutate({ id: line.id, patch: { bought: !line.bought } })
                      }
                      className={cn(
                        "h-7 w-7 items-center justify-center rounded border-bold border-ink",
                        line.bought ? "bg-sage" : "bg-card",
                      )}
                    >
                      {line.bought ? (
                        <Text className="font-bold text-base leading-5">✓</Text>
                      ) : null}
                    </Pressable>
                    <View className={cn("flex-1", line.bought && "opacity-50")}>
                      <Text variant="strong" className={line.bought ? "line-through" : undefined}>
                        {line.quantity === null || line.unit === null
                          ? ""
                          : `${amount(line.quantity, line.unit)} `}
                        {line.display_name}
                      </Text>
                      {wanted.length > 0 ? (
                        <Text variant="small">{t("list.for", { recipes: wanted.join(", ") })}</Text>
                      ) : null}
                    </View>
                    <Button
                      variant="quiet"
                      size="sm"
                      className="self-auto"
                      aria-label={t("list.remove", { name: line.display_name })}
                      onPress={() => remove.mutate(line.id)}
                    >
                      <Text>×</Text>
                    </Button>
                  </View>
                );
              })}
            </Card>
          ))
      )}

      {putAway.data && !choosing ? (
        <Text variant="hand" className="text-center">
          {t("list.putAway.done", { count: putAway.data.moved })}
        </Text>
      ) : null}
      {bought > 0 && !choosing ? (
        <Button onPress={() => setChoosing(true)}>
          <Text>{t("list.putAway")}</Text>
        </Button>
      ) : null}
      {choosing ? (
        <Card tilt={0.5} className="gap-3">
          <Text variant="label">{t("list.putAway.where")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {Location.options.map((location, index) => (
              <Chip
                key={location}
                index={index}
                label={t(`location.${location}`)}
                selected={false}
                onPress={() => putAway.mutate(location, { onSettled: () => setChoosing(false) })}
              />
            ))}
          </View>
          <Button
            variant="quiet"
            size="sm"
            className="self-start"
            onPress={() => setChoosing(false)}
          >
            <Text>{t("common.cancel")}</Text>
          </Button>
        </Card>
      ) : null}
      {putAway.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
    </Page>
  );
}

export default function ListScreen() {
  const me = useMe();
  const household = me.data?.household;
  return household ? <List householdId={household.id} /> : <Loading />;
}
