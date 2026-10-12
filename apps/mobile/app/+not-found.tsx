import { Link } from "expo-router";
import { View } from "react-native";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/use-t";

export default function NotFoundScreen() {
  const t = useT();
  return (
    <View className="flex-1 items-center justify-center gap-5 bg-paper p-8">
      <Sticker name="spoon" size={96} angle={-20} />
      <Text variant="title">{t("notFound.title")}</Text>
      <Text className="text-center">{t("notFound.body")}</Text>
      <Link href="/" asChild>
        <Button variant="paper" className="self-center">
          <Text>{t("notFound.home")}</Text>
        </Button>
      </Link>
    </View>
  );
}
