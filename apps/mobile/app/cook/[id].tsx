import type { CookView, DeviceStep } from "@snapcook/schema";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Finish } from "@/components/cooking/finish";
import { Rescue } from "@/components/cooking/rescue";
import { StepView } from "@/components/cooking/step-view";
import { StepCard } from "@/components/recipe/step-card";
import { Card, Label, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { saveStep, useCook } from "@/lib/cook";
import { amount } from "@/lib/format";
import { useMe } from "@/lib/queries";
import { useT } from "@/lib/use-t";

/** Each screen of the cook: one main step, with any side steps that run alongside it. */
function screens(steps: DeviceStep[]) {
  const groups: { main: DeviceStep; side: DeviceStep[] }[] = [];
  for (const step of steps) {
    const current = groups.at(-1);
    if (step.lane === "side" && current) current.side.push(step);
    else groups.push({ main: step, side: [] });
  }
  return groups;
}

function Cooking({ cook, householdId }: { cook: CookView; householdId: string }) {
  const t = useT();
  const router = useRouter();
  useKeepAwake();
  const groups = screens(cook.recipe.steps);
  const [at, setAt] = useState(() => Math.min(cook.current_step, groups.length - 1));
  const [finishing, setFinishing] = useState(false);
  const group = groups[at];
  const go = (next: number) => {
    setAt(next);
    saveStep(cook.id, next);
  };
  if (finishing || !group) return <Finish cook={cook} householdId={householdId} />;

  return (
    <Page>
      <View className="flex-row items-center justify-between">
        <Label>
          <Text variant="label">
            {t("cooking.step", { current: at + 1, total: groups.length })}
          </Text>
        </Label>
        <Button
          variant="quiet"
          size="sm"
          className="self-auto"
          onPress={() => router.replace("/(tabs)/cook")}
        >
          <Text>{t("cooking.leave")}</Text>
        </Button>
      </View>
      <Text variant="title">{cook.title}</Text>
      <Card tilt={-0.4} className="gap-5">
        <StepView
          cookId={cook.id}
          title={cook.title}
          step={group.main}
          ingredients={cook.recipe.ingredients}
        />
        {group.side.map((step) => (
          <StepView
            key={step.index}
            cookId={cook.id}
            title={cook.title}
            step={step}
            ingredients={cook.recipe.ingredients}
          />
        ))}
      </Card>
      <View className="flex-row gap-4">
        <Button variant="paper" className="flex-1" disabled={at === 0} onPress={() => go(at - 1)}>
          <Text>{t("cooking.back")}</Text>
        </Button>
        {at < groups.length - 1 ? (
          <Button className="flex-1" onPress={() => go(at + 1)}>
            <Text>{t("cooking.next")}</Text>
          </Button>
        ) : (
          <Button className="flex-1" onPress={() => setFinishing(true)}>
            <Text>{t("cooking.finish")}</Text>
          </Button>
        )}
      </View>
      <Rescue cookId={cook.id} stepIndex={group.main.index} />
    </Page>
  );
}

/** A finished cook, shown exactly as it was cooked. */
function AsCooked({ cook }: { cook: CookView }) {
  const t = useT();
  const router = useRouter();
  return (
    <Page>
      <Button
        variant="quiet"
        size="sm"
        className="self-start"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/cooked"))}
      >
        <Text>← {t("recipe.back")}</Text>
      </Button>
      <View className="gap-1">
        <Label className="bg-sage">
          <Text variant="label">{t("cooked.asCooked")}</Text>
        </Label>
        <Text variant="display">{cook.title}</Text>
        {cook.rating ? <Text variant="title">{"★".repeat(cook.rating)}</Text> : null}
      </View>
      <Card tilt={0.5} className="gap-1">
        <Label>
          <Text variant="label">{t("recipe.ingredients")}</Text>
        </Label>
        {cook.recipe.ingredients.map((line) => (
          <View
            key={`${line.ingredient_id}:${line.substituted_for ?? ""}`}
            className="flex-row items-baseline gap-3 border-b border-b-hairline border-ink/30 py-2"
          >
            <Text variant="strong" className="min-w-16">
              {line.quantity === null || line.unit === null
                ? t("recipe.toTaste")
                : amount(line.quantity, line.unit)}
            </Text>
            <Text className="flex-1">{line.display}</Text>
          </View>
        ))}
      </Card>
      <Card tilt={-0.4} className="gap-4">
        <Label className="bg-sage">
          <Text variant="label">{t("recipe.steps")}</Text>
        </Label>
        {cook.recipe.steps.map((step) => (
          <StepCard key={step.index} step={step} number={step.index + 1} />
        ))}
      </Card>
    </Page>
  );
}

export default function CookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const cook = useCook(id);
  const household = me.data?.household;
  if (cook.isError) return <Failed onRetry={() => cook.refetch()} />;
  if (!cook.data || !household) return <Loading />;
  return cook.data.finished_at ? (
    <AsCooked cook={cook.data} />
  ) : (
    <Cooking cook={cook.data} householdId={household.id} />
  );
}
