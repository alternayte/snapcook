import { Image } from "expo-image";
import { Link, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { pictureUrl } from "@/components/cook/result-card";
import { Card, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useSaved } from "@/lib/list";
import { useMe } from "@/lib/queries";
import { useT } from "@/lib/use-t";

function Saved({ householdId }: { householdId: string }) {
  const t = useT();
  const router = useRouter();
  const saved = useSaved(householdId);
  if (saved.isPending) return <Loading />;
  if (saved.isError) return <Failed onRetry={() => saved.refetch()} />;
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
      <Text variant="display">{t("saved.title")}</Text>
      {saved.data.length === 0 ? (
        <Text variant="hand" className="text-center">
          {t("saved.empty")}
        </Text>
      ) : (
        saved.data.map((recipe, index) => (
          <Link key={recipe.recipe_id} href={`/recipe/${recipe.recipe_id}`} asChild>
            <Pressable>
              <Card
                tilt={index % 2 === 0 ? -0.8 : 0.8}
                delay={index * 160}
                className="flex-row items-center gap-3 p-2.5"
              >
                {recipe.image ? (
                  <Image
                    source={pictureUrl(recipe.image)}
                    style={{ width: 84, height: 63, borderRadius: 2 }}
                    contentFit="cover"
                  />
                ) : null}
                <View className="flex-1 gap-0.5">
                  <Text variant="heading">{recipe.title}</Text>
                  <Text variant="small">
                    {t("saved.row", {
                      cuisine: recipe.cuisine.replaceAll("_", " "),
                      minutes: recipe.time_total_min,
                    })}
                  </Text>
                </View>
              </Card>
            </Pressable>
          </Link>
        ))
      )}
    </Page>
  );
}

export default function SavedScreen() {
  const me = useMe();
  const household = me.data?.household;
  return household ? <Saved householdId={household.id} /> : <Loading />;
}
