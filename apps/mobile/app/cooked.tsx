import { Link, useRouter } from "expo-router";
import { useIntl } from "react-intl";
import { Pressable, View } from "react-native";
import { Card, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useCookHistory } from "@/lib/cook";
import { useT } from "@/lib/use-t";

/** Every dish the household has cooked, newest first. */
export default function CookedScreen() {
  const t = useT();
  const intl = useIntl();
  const router = useRouter();
  const cooks = useCookHistory();
  if (cooks.isPending) return <Loading />;
  if (cooks.isError) return <Failed onRetry={() => cooks.refetch()} />;
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
      <Text variant="display">{t("cooked.title")}</Text>
      {cooks.data.length === 0 ? (
        <Text variant="hand" className="text-center">
          {t("cooked.empty")}
        </Text>
      ) : (
        <Card tilt={-0.4} className="gap-0">
          {cooks.data.map((cook) => (
            <Link key={cook.id} href={`/cook/${cook.id}`} asChild>
              <Pressable className="gap-0.5 border-b border-b-hairline border-ink/30 py-3">
                <View className="flex-row items-baseline justify-between gap-3">
                  <Text variant="strong" className="flex-1">
                    {cook.title}
                  </Text>
                  <Text className="font-bold text-sm text-tomato">
                    {cook.finished_at ? "★".repeat(cook.rating ?? 0) : t("cooked.unfinished")}
                  </Text>
                </View>
                <Text variant="small">
                  {t("cooked.row", {
                    date: intl.formatDate(cook.started_at, { day: "numeric", month: "short" }),
                    servings: cook.servings,
                  })}
                </Text>
              </Pressable>
            </Link>
          ))}
        </Card>
      )}
    </Page>
  );
}
