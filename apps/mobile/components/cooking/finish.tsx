import type { CookView, Deduction, FinishCookResponse } from "@snapcook/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AddToList } from "@/components/scrap/add-to-list";
import { Card, Label, Page } from "@/components/scrap/paper";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { useFinishCook } from "@/lib/cook";
import { amount, STEP } from "@/lib/format";
import { useT } from "@/lib/use-t";

const STARS = [1, 2, 3, 4, 5];

const sentence = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** The end of a cook: what it took from the pantry, what ran out, and how it went. */
export function Finish({ cook, householdId }: { cook: CookView; householdId: string }) {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const finish = useFinishCook(cook.id, householdId);
  const [deductions, setDeductions] = useState<Deduction[]>(cook.recipe.deductions);
  const [gone, setGone] = useState<string[]>([]);
  const [rating, setRating] = useState<number>();
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<Extract<FinishCookResponse, { outcome: "finished" }>>();
  const stuck = finish.data?.outcome === "needs_input" ? finish.data.needs_input : [];
  const name = (id: string) => cook.items[id]?.display_name ?? "";

  const send = (update: boolean) =>
    finish.mutate(
      {
        deductions: update ? deductions.filter((d) => d.quantity > 0) : [],
        gone: update ? gone : [],
        rating,
        notes: notes.trim() || undefined,
      },
      { onSuccess: (result) => (result.outcome === "finished" ? setDone(result) : undefined) },
    );
  const change = (index: number, by: 1 | -1) =>
    setDeductions((list) =>
      list.map((d, i) =>
        i === index
          ? {
              ...d,
              quantity: Math.max(0, Math.round((d.quantity + by * STEP[d.unit]) * 100) / 100),
            }
          : d,
      ),
    );

  if (done) {
    return (
      <Page>
        <View className="items-center gap-5 pt-16">
          <Sticker name="lemon" size={120} angle={10} />
          <Text variant="display" className="text-center">
            {t("finish.done.title")}
          </Text>
          {done.used_up.length > 0 ? (
            <Text className="text-center">
              {t("finish.done.usedUp", {
                items: sentence(done.used_up.map((item) => item.display_name)),
              })}
            </Text>
          ) : null}
          {done.used_up.length > 0 ? (
            <AddToList
              householdId={householdId}
              variant="paper"
              items={done.used_up.map((item) => ({
                ingredient_id: item.ingredient_id,
                display_name: item.display_name,
                quantity: null,
                unit: null,
              }))}
            />
          ) : null}
          <Button
            className="self-center"
            onPress={() => {
              // Only now does the cook count as finished on this screen: the summary stays until then.
              client.invalidateQueries({ queryKey: ["cook", cook.id] });
              router.replace("/(tabs)/pantry");
            }}
          >
            <Text>{t("finish.done.back")}</Text>
          </Button>
        </View>
      </Page>
    );
  }

  return (
    <Page>
      <View className="gap-1 pt-4">
        <Text variant="display">{t("finish.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("finish.note")}
        </Text>
      </View>

      <Card tape tilt={-0.5} className="gap-2 pt-6">
        <Label>
          <Text variant="label">{t("finish.used")}</Text>
        </Label>
        {deductions.length === 0 ? (
          <Text variant="small">{t("finish.none")}</Text>
        ) : (
          <Text variant="small">{t("finish.used.help")}</Text>
        )}
        {deductions.map((d, index) => (
          <View
            key={`${d.pantry_item_id}:${d.unit}`}
            className="flex-row items-center gap-3 border-b border-b-hairline border-ink/30 py-2"
          >
            <Text variant="strong" className="flex-1">
              {name(d.pantry_item_id)}
            </Text>
            <Button
              variant="paper"
              size="sm"
              className="self-auto"
              aria-label={t("finish.less", { name: name(d.pantry_item_id) })}
              onPress={() => change(index, -1)}
            >
              <Text>−</Text>
            </Button>
            <Text variant="strong" className="min-w-16 text-center">
              {amount(d.quantity, d.unit)}
            </Text>
            <Button
              variant="paper"
              size="sm"
              className="self-auto"
              aria-label={t("finish.more", { name: name(d.pantry_item_id) })}
              onPress={() => change(index, 1)}
            >
              <Text>+</Text>
            </Button>
          </View>
        ))}
        {stuck.length > 0 ? (
          <Text className="font-medium text-sm text-tomato">
            {t("finish.needsInput")} {sentence(stuck.map((d) => name(d.pantry_item_id)))}
          </Text>
        ) : null}
      </Card>

      {cook.confirm_still_have.length > 0 ? (
        <Card tilt={0.5} className="gap-3">
          <Label className="bg-sage">
            <Text variant="label">{t("finish.stillHave")}</Text>
          </Label>
          <View className="flex-row flex-wrap gap-2">
            {cook.confirm_still_have.map((item, index) => {
              const on = gone.includes(item.pantry_item_id);
              return (
                <Chip
                  key={item.pantry_item_id}
                  index={index}
                  label={t("finish.gone", { name: item.display_name })}
                  selected={on}
                  onPress={() =>
                    setGone(
                      on
                        ? gone.filter((id) => id !== item.pantry_item_id)
                        : [...gone, item.pantry_item_id],
                    )
                  }
                />
              );
            })}
          </View>
        </Card>
      ) : null}

      <Card tilt={-0.4} className="gap-3">
        <Text variant="label">{t("finish.rating")}</Text>
        <View className="flex-row gap-2">
          {STARS.map((star, index) => (
            <Chip
              key={star}
              index={index}
              label={"★".repeat(star)}
              selected={rating === star}
              onPress={() => setRating(rating === star ? undefined : star)}
            />
          ))}
        </View>
        <Field
          label={t("finish.notes")}
          placeholder={t("finish.notes.placeholder")}
          value={notes}
          onChangeText={setNotes}
          maxLength={500}
          multiline
        />
      </Card>

      <Button disabled={finish.isPending} onPress={() => send(true)}>
        <Text>{t("finish.confirm")}</Text>
      </Button>
      <Button variant="quiet" disabled={finish.isPending} onPress={() => send(false)}>
        <Text>{t("finish.skip")}</Text>
      </Button>
      {finish.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
    </Page>
  );
}
