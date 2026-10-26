import type { SuggestionCard } from "@snapcook/schema";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, View } from "react-native";
import { Card, Label } from "@/components/scrap/paper";
import { Text } from "@/components/ui/text";
import { API_URL } from "@/lib/auth";
import { useT } from "@/lib/use-t";

export const pictureUrl = (file: string) => `${API_URL}/api/v1/images/${file}`;

const sentence = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

type Props = { card: SuggestionCard; names: Record<string, string>; index: number };

/** One suggested dish: its picture taped on, what it takes, and why it fits. */
export function ResultCard({ card, names, index }: Props) {
  const t = useT();
  const have = card.have.length + card.substituted.length;
  const words = card.cuisine.replaceAll("_", " ");
  const cuisine = words.charAt(0).toUpperCase() + words.slice(1);
  return (
    <Link href={`/recipe/${card.recipe_id}`} asChild>
      <Pressable aria-label={t("cook.card.open", { title: card.title })}>
        <Card tape tilt={index % 2 === 0 ? -1.2 : 1} className="gap-2 p-2.5 pb-4">
          {card.image ? (
            <View>
              <Image
                source={pictureUrl(card.image)}
                style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 2 }}
                contentFit="cover"
                accessibilityLabel={card.title}
              />
              <Text className="absolute bottom-1 right-1.5 font-body text-xs text-card">
                {t("cook.card.illustrative")}
              </Text>
            </View>
          ) : null}
          <View className="gap-1.5 px-1.5">
            <Text variant="title">{card.title}</Text>
            <Text variant="small">
              {t("cook.card.meta", {
                cuisine,
                total: card.time_total_min,
                active: card.time_active_min,
              })}
            </Text>
            <View className="flex-row flex-wrap items-center gap-2">
              <Label className="bg-sage">
                <Text variant="label">
                  {t("cook.card.have", { have, all: have + card.missing.length })}
                </Text>
              </Label>
              {card.has_device_variant ? (
                <Label>
                  <Text variant="label">{t("cook.card.device")}</Text>
                </Label>
              ) : null}
            </View>
            {card.missing.length > 0 ? (
              <Text variant="small">
                {t("cook.card.missing", {
                  items: sentence(card.missing.map((id) => names[id] ?? "")),
                })}
              </Text>
            ) : null}
            {card.reason ? <Text>{card.reason}.</Text> : null}
            {card.disliked.length > 0 ? (
              <Text className="font-medium text-sm text-tomato">
                {t("cook.card.swap", {
                  items: sentence(card.disliked.map((id) => names[id] ?? "")),
                })}
              </Text>
            ) : null}
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}
