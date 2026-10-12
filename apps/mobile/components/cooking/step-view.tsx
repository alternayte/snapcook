import type { AdaptedRecipe, DeviceStep } from "@snapcook/schema";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { amount, clock } from "@/lib/format";
import { startTimer, stopTimer, useTimer } from "@/lib/timers";
import { useT } from "@/lib/use-t";
import { cn } from "@/lib/utils";

type Props = {
  cookId: string;
  title: string;
  step: DeviceStep;
  ingredients: AdaptedRecipe["ingredients"];
};

function Timer({ cookId, title, step }: Pick<Props, "cookId" | "title" | "step">) {
  const t = useT();
  const key = `${cookId}:${step.index}`;
  const left = useTimer(key);
  if (step.minutes === undefined) return null;
  if (left === null) {
    return (
      <Button
        variant="paper"
        className="self-start"
        onPress={() =>
          startTimer(
            key,
            step.minutes ?? 0,
            t("cooking.timer.notification", { title, step: step.index + 1 }),
          )
        }
      >
        <Text>{t("cooking.timer.start", { minutes: step.minutes })}</Text>
      </Button>
    );
  }
  return (
    <View className="flex-row items-center gap-4">
      <Text className={cn("font-display text-3xl", left === 0 && "text-tomato")} aria-live="polite">
        {left === 0 ? t("cooking.timer.done") : clock(left)}
      </Text>
      <Button variant="quiet" size="sm" className="self-auto" onPress={() => stopTimer(key)}>
        <Text>{t("cooking.timer.stop")}</Text>
      </Button>
    </View>
  );
}

/** One step, large enough to read from the other side of the worktop. */
export function StepView({ cookId, title, step, ingredients }: Props) {
  const t = useT();
  const side = step.lane === "side";
  // The ingredients this step names, so the cook does not scroll back for an amount.
  const text = step.text.toLowerCase();
  const used = ingredients.filter(
    (i) => i.display !== "" && text.includes(i.display.toLowerCase()),
  );
  return (
    <View className={cn("gap-4", side && "rounded-paper border-ink border-ink bg-paper p-3")}>
      <Text variant="label" className="text-ink-soft">
        {side ? `${t("recipe.step.meanwhile")} · ` : ""}
        {t(`recipe.step.kind.${step.kind}`)}
      </Text>
      <Text className={side ? "font-body text-lg" : "font-medium text-xl"}>{step.text}</Text>
      {step.mc ? (
        <View className="flex-row flex-wrap gap-2 rounded border-bold border-ink bg-mustard p-3">
          {[
            t("recipe.device.temp", { temp: step.mc.temp_c }),
            t("recipe.step.minutes", { minutes: step.mc.minutes }),
            t("recipe.device.speed", { speed: step.mc.speed }),
            ...(step.mc.reverse ? [t("recipe.device.reverse")] : []),
            ...(step.mc.accessory ? [t(`recipe.device.accessory.${step.mc.accessory}`)] : []),
          ].map((setting) => (
            <View key={setting} className="rounded-[2px] bg-card px-3 py-2">
              <Text className="font-title text-xl">{setting}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Timer cookId={cookId} title={title} step={step} />
      {used.length > 0 ? (
        <View className="gap-1">
          <Text variant="label" className="text-ink-soft">
            {t("cooking.uses")}
          </Text>
          {used.map((i) => (
            <Text key={i.ingredient_id}>
              {i.quantity === null || i.unit === null ? "" : `${amount(i.quantity, i.unit)} `}
              {i.display}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
