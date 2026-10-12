import {
  Effort,
  type HouseholdProfile,
  type SuggestInput,
  type SuggestResponse,
} from "@snapcook/schema";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ResultCard } from "@/components/cook/result-card";
import { Card, Label, Page } from "@/components/scrap/paper";
import { Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { useMe, usePantry, useSuggest } from "@/lib/queries";
import { useT } from "@/lib/use-t";

const TIMES_MIN = [20, 30, 45, 60, 90];
const SERVINGS_STEP = 0.5;

const sentence = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

function Cook({ householdId, profile }: { householdId: string; profile: HouseholdProfile }) {
  const t = useT();
  const pantry = usePantry(householdId);
  const suggest = useSuggest();
  const [input, setInput] = useState<Required<Omit<SuggestInput, "craving">> & { craving: string }>(
    {
      time_budget_min: profile.default_time_min,
      servings: profile.default_servings,
      effort: profile.effort,
      use_up: [],
      craving: "",
      mc_only: false,
    },
  );
  // Every page of the current answer, in the order it arrived.
  const [pages, setPages] = useState<SuggestResponse[]>([]);
  const set = (patch: Partial<typeof input>) => setInput((current) => ({ ...current, ...patch }));
  const last = pages.at(-1);
  const results = pages.flatMap((page) => page.results);
  const names = Object.assign({}, ...pages.map((page) => page.names)) as Record<string, string>;
  const stocked = (pantry.data ?? []).filter((item) => item.ingredient_id !== null);
  const times = [...new Set([...TIMES_MIN, profile.default_time_min])].sort((a, b) => a - b);

  const ask = () => {
    // The old answer goes at once, so a new one is visibly on its way.
    setPages([]);
    suggest.mutate(
      { input: { ...input, craving: input.craving.trim() || null } },
      { onSuccess: (page) => setPages([page]) },
    );
  };
  const more = () =>
    last?.next_cursor
      ? suggest.mutate(
          { input: {}, cursor: last.next_cursor },
          { onSuccess: (page) => setPages((all) => [...all, page]) },
        )
      : undefined;

  return (
    <Page>
      <View className="h-24">
        <Label>
          <Text variant="label">{t("tabs.cook")}</Text>
        </Label>
        <Sticker
          name="tomato"
          size={100}
          angle={8}
          delay={150}
          style={{ position: "absolute", right: 0, top: -6 }}
        />
        <Sticker
          name="garlic"
          size={64}
          angle={-14}
          delay={300}
          style={{ position: "absolute", right: 90, top: 36 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("cook.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("cook.note")}
        </Text>
      </View>

      <Card tape tilt={-0.6} className="gap-4 pt-6">
        <View className="gap-2">
          <Text variant="label">{t("cook.time")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {times.map((minutes, index) => (
              <Chip
                key={minutes}
                index={index}
                label={t("cook.time.value", { minutes })}
                selected={input.time_budget_min === minutes}
                onPress={() => set({ time_budget_min: minutes })}
              />
            ))}
          </View>
        </View>
        <View className="flex-row items-center justify-between">
          <Text variant="label">{t("cook.servings")}</Text>
          <View className="flex-row items-center gap-3">
            <Button
              variant="paper"
              size="sm"
              className="self-auto"
              aria-label={`${t("profile.fewer")}: ${t("cook.servings")}`}
              onPress={() =>
                set({ servings: Math.max(SERVINGS_STEP, input.servings - SERVINGS_STEP) })
              }
            >
              <Text>−</Text>
            </Button>
            <Text variant="strong" className="min-w-10 text-center">
              {input.servings}
            </Text>
            <Button
              variant="paper"
              size="sm"
              className="self-auto"
              aria-label={`${t("profile.more")}: ${t("cook.servings")}`}
              onPress={() => set({ servings: input.servings + SERVINGS_STEP })}
            >
              <Text>+</Text>
            </Button>
          </View>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {Effort.options.map((value, index) => (
            <Chip
              key={value}
              index={index}
              label={t(`effort.${value}`)}
              selected={input.effort === value}
              onPress={() => set({ effort: value })}
            />
          ))}
          {profile.devices.mc_smart ? (
            <Chip
              index={2}
              label={t("cook.device")}
              selected={input.mc_only}
              onPress={() => set({ mc_only: !input.mc_only })}
            />
          ) : null}
        </View>
        <Field
          label={t("cook.craving")}
          placeholder={t("cook.craving.placeholder")}
          value={input.craving}
          onChangeText={(craving) => set({ craving })}
          maxLength={80}
        />
        {stocked.length > 0 ? (
          <View className="gap-2">
            <Text variant="label">{t("cook.useUp")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {stocked.map((item, index) => {
                const id = item.ingredient_id ?? "";
                const on = input.use_up.includes(id);
                return (
                  <Chip
                    key={item.id}
                    index={index}
                    label={item.display_name}
                    selected={on}
                    onPress={() =>
                      set({
                        use_up: on
                          ? input.use_up.filter((other) => other !== id)
                          : [...input.use_up, id],
                      })
                    }
                  />
                );
              })}
            </View>
          </View>
        ) : null}
      </Card>

      <Button disabled={suggest.isPending} onPress={ask}>
        <Text>
          {suggest.isPending
            ? t("cook.looking")
            : pages.length > 0
              ? t("cook.again")
              : t("cook.submit")}
        </Text>
      </Button>
      {suggest.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}

      {results.map((card, index) => (
        <ResultCard key={card.recipe_version_id} card={card} names={names} index={index} />
      ))}
      {last?.next_cursor ? (
        <Button variant="paper" disabled={suggest.isPending} onPress={more}>
          <Text>{t("cook.more")}</Text>
        </Button>
      ) : null}

      {suggest.isPending ? (
        <View className="items-center py-4">
          <Sticker name="pan" size={72} angle={-8} />
        </View>
      ) : null}
      {results.length > 0 && last && !last.next_cursor && !suggest.isPending ? (
        <Text variant="hand" className="text-center">
          {t("cook.end")}
        </Text>
      ) : null}

      {pages.length > 0 && results.length === 0 ? (
        <View className="items-center gap-4">
          <Text variant="hand" className="text-center">
            {pantry.data?.length === 0 ? t("cook.empty.pantry") : t("cook.empty.results")}
          </Text>
          {pantry.data?.length === 0 ? (
            <Link href="/snap" asChild>
              <Button variant="paper" className="self-center">
                <Text>{t("pantry.snap")}</Text>
              </Button>
            </Link>
          ) : null}
        </View>
      ) : null}

      {pages[0] && pages[0].closest.length > 0 ? (
        <Card tilt={0.6} className="gap-3">
          <Label className="bg-sage">
            <Text variant="label">{t("cook.closest")}</Text>
          </Label>
          {pages[0].closest.map((miss) => (
            <Link key={miss.recipe_version_id} href={`/recipe/${miss.recipe_id}`} asChild>
              <Pressable className="gap-0.5 border-b border-b-hairline border-ink/30 py-2">
                <Text variant="strong">{miss.title}</Text>
                <Text variant="small">
                  {t("cook.closest.needs", {
                    items: sentence(miss.missing_core.map((id) => names[id] ?? "")),
                  })}
                </Text>
              </Pressable>
            </Link>
          ))}
        </Card>
      ) : null}
      <Link href="/cooked" asChild>
        <Button variant="quiet">
          <Text>{t("cooked.link")}</Text>
        </Button>
      </Link>
    </Page>
  );
}

export default function CookScreen() {
  const me = useMe();
  const household = me.data?.household;
  const profile = me.data?.profile;
  return household && profile ? <Cook householdId={household.id} profile={profile} /> : <Loading />;
}
