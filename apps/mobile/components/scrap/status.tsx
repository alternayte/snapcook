import { View } from "react-native";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/use-t";

/** What a screen shows while its data is on the way: one sticker, moving. */
export function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-paper">
      <Sticker name="pan" size={96} angle={-8} />
    </View>
  );
}

/** What a screen shows when its data did not arrive. */
export function Failed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <View className="flex-1 items-center justify-center gap-5 bg-paper px-8">
      <Sticker name="lemon" size={88} angle={12} />
      <Text className="text-center">{t("common.error")}</Text>
      <Button variant="paper" onPress={onRetry} className="self-center">
        <Text>{t("common.retry")}</Text>
      </Button>
    </View>
  );
}
