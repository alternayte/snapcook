import type { BrowseFilter, BrowseQuery } from "@snapcook/schema";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, ScrollView, View } from "react-native";
import { BrowseCard } from "@/components/recipes/browse-card";
import { CookedList } from "@/components/recipes/cooked-list";
import { Label, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { useMe } from "@/lib/queries";
import { useBrowse } from "@/lib/recipes";
import { useT } from "@/lib/use-t";

const SOURCES: (BrowseFilter | "cooked")[] = [
  "official",
  "community",
  "household",
  "saved",
  "cooked",
];
const TIMES_MIN = [30, 45, 60];
// Typing waits this long before the list is asked for again.
const SEARCH_WAIT_MS = 300;

function Recipes({ householdId }: { householdId: string }) {
  const t = useT();
  const [source, setSource] = useState<BrowseFilter | "cooked" | undefined>();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState<BrowseQuery>({ fits: true, sort: "match" });
  const set = (patch: Partial<BrowseQuery>) => setQuery((current) => ({ ...current, ...patch }));
  useEffect(() => {
    const wait = setTimeout(
      () => setQuery((current) => ({ ...current, q: typed.trim() || undefined })),
      SEARCH_WAIT_MS,
    );
    return () => clearTimeout(wait);
  }, [typed]);
  const cooked = source === "cooked";
  const browse = useBrowse(householdId, {
    ...query,
    source: cooked ? undefined : source,
  });

  const header = (
    <View className="gap-5 pb-4">
      <View className="h-20">
        <Label>
          <Text variant="label">{t("tabs.recipes")}</Text>
        </Label>
        <Sticker
          name="spoon"
          size={84}
          angle={-12}
          delay={150}
          style={{ position: "absolute", right: 6, top: -4 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("recipes.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("recipes.note")}
        </Text>
      </View>
      <Link href="/import/new" asChild>
        <Button>
          <Text>{t("recipes.add")}</Text>
        </Button>
      </Link>
      <View className="flex-row flex-wrap gap-2">
        {SOURCES.map((value, index) => (
          <Chip
            key={value}
            index={index}
            label={t(`recipes.chip.${value}`)}
            selected={source === value}
            onPress={() => setSource(source === value ? undefined : value)}
          />
        ))}
      </View>
      {cooked ? null : (
        <>
          <Field
            label={t("recipes.search")}
            placeholder={t("recipes.search.placeholder")}
            value={typed}
            onChangeText={setTyped}
            maxLength={80}
            returnKeyType="search"
          />
          <View className="gap-2">
            <Text variant="label">{t("recipes.filters")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {TIMES_MIN.map((minutes, index) => (
                <Chip
                  key={minutes}
                  index={index}
                  label={t("recipes.filter.time", { minutes })}
                  selected={query.max_time === minutes}
                  onPress={() =>
                    set({ max_time: query.max_time === minutes ? undefined : minutes })
                  }
                />
              ))}
              <Chip
                index={3}
                label={t("recipes.filter.lazy")}
                selected={query.effort === "lazy"}
                onPress={() => set({ effort: query.effort === "lazy" ? undefined : "lazy" })}
              />
              <Chip
                index={4}
                label={t("recipes.filter.machine")}
                selected={query.mc_only === true}
                onPress={() => set({ mc_only: query.mc_only ? undefined : true })}
              />
              <Chip
                index={5}
                label={t("recipes.filter.fits")}
                selected={query.fits !== false}
                onPress={() => set({ fits: query.fits === false })}
              />
              <Chip
                index={6}
                label={t("recipes.sort.title")}
                selected={query.sort === "title"}
                onPress={() => set({ sort: query.sort === "title" ? "match" : "title" })}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2 py-1"
            >
              <Chip
                label={t("recipes.cuisine.all")}
                selected={query.cuisine === undefined}
                onPress={() => set({ cuisine: undefined })}
              />
              {(browse.data?.cuisines ?? []).map((cuisine, index) => {
                const words = cuisine.replaceAll("_", " ");
                return (
                  <Chip
                    key={cuisine}
                    index={index + 1}
                    label={words.charAt(0).toUpperCase() + words.slice(1)}
                    selected={query.cuisine === cuisine}
                    onPress={() =>
                      set({ cuisine: query.cuisine === cuisine ? undefined : cuisine })
                    }
                  />
                );
              })}
            </ScrollView>
          </View>
          {browse.data ? (
            <Text variant="small">{t("recipes.count", { count: browse.data.cards.length })}</Text>
          ) : null}
        </>
      )}
    </View>
  );

  if (cooked) {
    return (
      <Page>
        {header}
        <CookedList />
      </Page>
    );
  }
  if (browse.isError) return <Failed onRetry={() => browse.refetch()} />;
  return (
    <Page scroll={false}>
      <FlatList
        data={browse.data?.cards ?? []}
        keyExtractor={(card) => card.recipe_version_id}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-16"
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item }) => (
          <BrowseCard card={item} names={browse.data?.names ?? {}} householdId={householdId} />
        )}
        ListEmptyComponent={
          browse.isPending ? (
            <Loading />
          ) : (
            <Text variant="hand" className="text-center">
              {source === "household" ? t("recipes.empty.household") : t("recipes.empty")}
            </Text>
          )
        }
      />
    </Page>
  );
}

export default function RecipesScreen() {
  const me = useMe();
  const household = me.data?.household;
  return household ? <Recipes householdId={household.id} /> : <Loading />;
}
