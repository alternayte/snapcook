import { MAX_IMPORT_IMAGES } from "@snapcook/schema";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Card, Page } from "@/components/scrap/paper";
import { PlanLimit } from "@/components/scrap/plan-limit";
import { Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { isAllowanceError } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { useStartImport } from "@/lib/recipes";
import { useT } from "@/lib/use-t";

function NewImport({ importsLeft }: { importsLeft: number | null }) {
  const t = useT();
  const router = useRouter();
  const start = useStartImport();
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const room = MAX_IMPORT_IMAGES - assets.length;

  async function add(source: "camera" | "gallery") {
    const options = { mediaTypes: ["images" as const], quality: 1 };
    const picked =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({
            ...options,
            allowsMultipleSelection: true,
            selectionLimit: room,
            orderedSelection: true,
          });
    if (picked.canceled) return;
    setAssets((list) => [...list, ...picked.assets].slice(0, MAX_IMPORT_IMAGES));
  }

  return (
    <Page>
      <Button
        variant="quiet"
        size="sm"
        className="self-start"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/recipes"))}
      >
        <Text>← {t("recipe.back")}</Text>
      </Button>
      <View className="h-16">
        <Sticker
          name="lemon"
          size={76}
          angle={10}
          delay={150}
          style={{ position: "absolute", right: 4, top: -8 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("import.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("import.note")}
        </Text>
      </View>

      <Card tape tilt={-0.6} className="gap-4 pt-6">
        <Text>{t("import.help", { max: MAX_IMPORT_IMAGES })}</Text>
        <Button disabled={room <= 0} onPress={() => add("camera")}>
          <Text>{t("import.camera")}</Text>
        </Button>
        <Button variant="paper" disabled={room <= 0} onPress={() => add("gallery")}>
          <Text>{t("import.gallery")}</Text>
        </Button>
        {importsLeft === null ? null : (
          <Text variant="small">{t("import.left", { left: importsLeft })}</Text>
        )}
      </Card>

      {assets.length > 0 ? (
        <View className="flex-row flex-wrap gap-3">
          {assets.map((asset, index) => (
            <Pressable
              key={asset.uri}
              aria-label={t("import.image.remove", { number: index + 1 })}
              onPress={() => setAssets((list) => list.filter((other) => other.uri !== asset.uri))}
              className="w-[30%] rounded-paper bg-card p-1.5 shadow-sm shadow-ink/30"
              style={{ transform: [{ rotate: index % 2 === 0 ? "-2deg" : "1.5deg" }] }}
            >
              <Image
                source={asset.uri}
                style={{ width: "100%", aspectRatio: 3 / 4 }}
                contentFit="cover"
              />
              <Text className="pt-1 text-center font-bold text-xs text-ink-soft">
                {t("import.image.remove", { number: index + 1 })}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {(start.isError && isAllowanceError(start.error)) || importsLeft === 0 ? <PlanLimit /> : null}
      {start.isError && !isAllowanceError(start.error) ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
      <Button
        disabled={assets.length === 0 || start.isPending || importsLeft === 0}
        onPress={() =>
          start.mutate(assets, {
            onSuccess: ({ import_id }) => router.replace(`/import/${import_id}`),
          })
        }
      >
        <Text>{t("import.read")}</Text>
      </Button>
    </Page>
  );
}

export default function NewImportScreen() {
  const me = useMe();
  const entitlements = me.data?.entitlements;
  if (!entitlements) return <Loading />;
  const { limit, used } = entitlements.imports;
  return <NewImport importsLeft={limit === null ? null : Math.max(0, limit - used)} />;
}
