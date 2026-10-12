import type { AdaptationControls, AdaptedRecipe, RecipeView, Unit } from "@snapcook/schema";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { pictureUrl } from "@/components/cook/result-card";
import { StepCard } from "@/components/recipe/step-card";
import { AddToList } from "@/components/scrap/add-to-list";
import { Card, Label, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Text } from "@/components/ui/text";
import { useStartCook } from "@/lib/cook";
import { amount } from "@/lib/format";
import { useSaved, useToggleSaved } from "@/lib/list";
import { useAdaptation, useMe, useRecipe } from "@/lib/queries";
import { useT } from "@/lib/use-t";
import { cn } from "@/lib/utils";

const SERVINGS_STEP = 0.5;
type Shown = {
  key: string;
  ingredient_id: string;
  name: string;
  quantity: number | null;
  unit: Unit | null;
  status?: AdaptedRecipe["ingredients"][number]["status"];
  substituted_for?: string;
};

function Recipe({
  recipe,
  householdId,
  hasDevice,
}: {
  recipe: RecipeView;
  householdId: string;
  hasDevice: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [controls, setControls] = useState<Partial<AdaptationControls>>({});
  const adaptation = useAdaptation(householdId, recipe.recipe_version_id, controls);
  const start = useStartCook();
  const saved = useSaved(householdId);
  const toggleSaved = useToggleSaved(householdId);
  const isSaved = saved.data?.some((r) => r.recipe_id === recipe.recipe_id) ?? false;
  const fitted = adaptation.data;
  const set = (patch: Partial<AdaptationControls>) =>
    setControls((current) => ({ ...current, ...patch }));
  const name = (id: string) => recipe.ingredients.find((i) => i.ingredient_id === id)?.name ?? "";
  const words = recipe.cuisine.replaceAll("_", " ");

  // Until the fitted version arrives, the recipe shows as written.
  const lines: Shown[] = fitted
    ? fitted.recipe.ingredients.map((i, index) => ({
        ...i,
        key: `${i.ingredient_id}:${index}`,
        name: i.display,
      }))
    : recipe.ingredients.map((i, index) => ({ ...i, key: `${i.ingredient_id}:${index}` }));
  const steps = fitted?.recipe.steps ?? recipe.steps;
  const servings = fitted?.controls.servings ?? recipe.base_servings;

  return (
    <Page>
      <Button
        variant="quiet"
        size="sm"
        className="self-start"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/cook"))}
      >
        <Text>← {t("recipe.back")}</Text>
      </Button>
      {recipe.image ? (
        <Card tape tilt={-1} className="p-2.5">
          <Image
            source={pictureUrl(recipe.image)}
            style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 2 }}
            contentFit="cover"
            accessibilityLabel={recipe.title}
          />
          <Text className="absolute bottom-3.5 right-4 font-body text-xs text-card">
            {t("cook.card.illustrative")}
          </Text>
        </Card>
      ) : null}
      <View className="gap-1.5">
        <Text variant="display">{recipe.title}</Text>
        <Text variant="small">
          {t("recipe.meta", {
            cuisine: words.charAt(0).toUpperCase() + words.slice(1),
            total: recipe.time_total_min,
            active: recipe.time_active_min,
          })}
        </Text>
        <Text>{recipe.description}</Text>
      </View>
      <Chip
        label={isSaved ? t("saved.saved") : t("saved.save")}
        selected={isSaved}
        onPress={() => toggleSaved.mutate({ recipeId: recipe.recipe_id, save: !isSaved })}
      />

      {adaptation.isFetching ? (
        <View className="flex-row items-center gap-3">
          <Sticker name="pan" size={56} angle={-8} />
          <View className="flex-1">
            <Text variant="strong">{t("recipe.fitting")}</Text>
            <Text variant="hand">{t("recipe.fitting.note")}</Text>
          </View>
        </View>
      ) : null}
      {adaptation.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("recipe.failed")}</Text>
      ) : null}
      {fitted?.recipe.refused ? (
        <Card tilt={0.6} className="gap-1 bg-mustard">
          <Text variant="label">{t("recipe.refused")}</Text>
          <Text>{fitted.recipe.refused.reason}</Text>
        </Card>
      ) : null}

      {fitted ? (
        <Card tilt={-0.5} className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="label">{t("recipe.servings")}</Text>
            <View className="flex-row items-center gap-3">
              <Button
                variant="paper"
                size="sm"
                className="self-auto"
                aria-label={`${t("profile.fewer")}: ${t("recipe.servings")}`}
                onPress={() => set({ servings: Math.max(SERVINGS_STEP, servings - SERVINGS_STEP) })}
              >
                <Text>−</Text>
              </Button>
              <Text variant="strong" className="min-w-10 text-center">
                {servings}
              </Text>
              <Button
                variant="paper"
                size="sm"
                className="self-auto"
                aria-label={`${t("profile.more")}: ${t("recipe.servings")}`}
                onPress={() => set({ servings: servings + SERVINGS_STEP })}
              >
                <Text>+</Text>
              </Button>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Chip
              label={t("recipe.control.toddler")}
              selected={fitted.controls.toddler_safe}
              onPress={() => set({ toddler_safe: !fitted.controls.toddler_safe })}
            />
            {recipe.has_device_variant && hasDevice ? (
              <Chip
                index={1}
                label={t("recipe.control.noDevice")}
                selected={fitted.controls.device_profile_id === null}
                onPress={() =>
                  set({
                    device_profile_id:
                      fitted.controls.device_profile_id === null ? "mc_smart" : null,
                  })
                }
              />
            ) : null}
            <Chip
              index={2}
              label={t("recipe.control.lazier")}
              selected={fitted.controls.lazier}
              onPress={() => set({ lazier: !fitted.controls.lazier })}
            />
          </View>
        </Card>
      ) : null}

      <Card tilt={0.5} className="gap-1">
        <Label>
          <Text variant="label">{t("recipe.ingredients")}</Text>
        </Label>
        {lines.map((line) => {
          const options =
            line.status === "missing" ? (fitted?.swap_options[line.ingredient_id] ?? []) : [];
          return (
            <View key={line.key} className="gap-1.5 border-b border-b-hairline border-ink/30 py-2">
              <View className="flex-row items-baseline gap-3">
                <Text variant="strong" className="min-w-16">
                  {line.quantity === null || line.unit === null
                    ? t("recipe.toTaste")
                    : amount(line.quantity, line.unit)}
                </Text>
                <Text className="flex-1">{line.name}</Text>
                {line.status ? (
                  <Text
                    className={cn(
                      "font-medium text-sm",
                      line.status === "missing" ? "text-tomato" : "text-ink-soft",
                    )}
                  >
                    {line.status === "substituted"
                      ? t("recipe.status.substituted", { name: name(line.substituted_for ?? "") })
                      : t(`recipe.status.${line.status}`)}
                  </Text>
                ) : null}
              </View>
              {line.status === "missing" ? (
                <AddToList
                  householdId={householdId}
                  items={[
                    {
                      ingredient_id: line.ingredient_id,
                      display_name: line.name,
                      quantity: line.quantity,
                      unit: line.unit,
                      recipe_id: recipe.recipe_id,
                    },
                  ]}
                />
              ) : null}
              {options.length > 0 ? (
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text variant="small">{t("recipe.swap")}</Text>
                  {options.map((option, index) => (
                    <Chip
                      key={option.pantry_item_id}
                      index={index}
                      label={option.name}
                      selected={false}
                      onPress={() =>
                        set({
                          swaps: [
                            ...(fitted?.controls.swaps ?? []).filter(
                              (s) => s.ingredient_id !== line.ingredient_id,
                            ),
                            {
                              ingredient_id: line.ingredient_id,
                              pantry_item_id: option.pantry_item_id,
                            },
                          ],
                        })
                      }
                    />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      <Card tilt={-0.4} className="gap-4">
        <Label className="bg-sage">
          <Text variant="label">{t("recipe.steps")}</Text>
        </Label>
        {steps.map((step) => (
          <StepCard key={step.index} step={step} number={step.index + 1} />
        ))}
      </Card>

      {fitted ? (
        <Button
          disabled={start.isPending || adaptation.isFetching}
          onPress={() =>
            start.mutate(fitted.adaptation_id, {
              onSuccess: (cook) => router.push(`/cook/${cook.id}`),
            })
          }
        >
          <Text>{t("recipe.start")}</Text>
        </Button>
      ) : null}
      {start.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}

      {fitted && fitted.recipe.tips.length > 0 ? (
        <Card tilt={0.5} className="gap-2">
          <Label>
            <Text variant="label">{t("recipe.tips")}</Text>
          </Label>
          {fitted.recipe.tips.map((tip) => (
            <Text key={tip}>• {tip}</Text>
          ))}
        </Card>
      ) : null}
      {fitted && fitted.recipe.toddler_notes.length > 0 ? (
        <Card tilt={-0.5} className="gap-2">
          <Label className="bg-sage">
            <Text variant="label">{t("recipe.toddler")}</Text>
          </Label>
          {fitted.recipe.toddler_notes.map((note) => (
            <Text key={note}>• {note}</Text>
          ))}
        </Card>
      ) : null}
    </Page>
  );
}

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const recipe = useRecipe(id);
  const household = me.data?.household;
  if (recipe.isError) return <Failed onRetry={() => recipe.refetch()} />;
  if (!recipe.data || !household) return <Loading />;
  return (
    <Recipe
      recipe={recipe.data}
      householdId={household.id}
      hasDevice={me.data?.profile?.devices.mc_smart ?? false}
    />
  );
}
