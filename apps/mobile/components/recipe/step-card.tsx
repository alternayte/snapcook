import type { DeviceStep } from "@snapcook/schema";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/use-t";
import { cn } from "@/lib/utils";

/** One step of the method. A machine step shows its settings as a panel to copy onto the device. */
export function StepCard({ step, number }: { step: DeviceStep; number: number }) {
  const t = useT();
  const side = step.lane === "side";
  return (
    <View className={cn("flex-row gap-3", side && "ml-6")}>
      <View
        className={cn(
          "h-8 w-8 items-center justify-center rounded-full border-ink border-ink",
          side ? "bg-paper" : "bg-mustard",
        )}
      >
        <Text variant="strong">{number}</Text>
      </View>
      <View className="flex-1 gap-1.5">
        <Text variant="label" className="text-ink-soft">
          {side ? `${t("recipe.step.meanwhile")} · ` : ""}
          {t(`recipe.step.kind.${step.kind}`)}
          {step.minutes === undefined
            ? ""
            : ` · ${t("recipe.step.minutes", { minutes: step.minutes })}`}
        </Text>
        <Text>{step.text}</Text>
        {step.mc ? (
          <View className="flex-row flex-wrap gap-2 rounded border-bold border-ink bg-paper p-2.5">
            {[
              t("recipe.device.temp", { temp: step.mc.temp_c }),
              t("recipe.step.minutes", { minutes: step.mc.minutes }),
              t("recipe.device.speed", { speed: step.mc.speed }),
              ...(step.mc.reverse ? [t("recipe.device.reverse")] : []),
              ...(step.mc.accessory ? [t(`recipe.device.accessory.${step.mc.accessory}`)] : []),
            ].map((setting) => (
              <View key={setting} className="rounded-[2px] bg-card px-2 py-1">
                <Text className="font-bold text-sm">{setting}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
