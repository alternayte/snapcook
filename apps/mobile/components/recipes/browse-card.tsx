import type { BrowseCard as Card } from "@snapcook/schema";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, View } from "react-native";
import { pictureUrl } from "@/components/cook/result-card";
import { AddMissing } from "@/components/recipes/add-missing";
import { SourceLabel } from "@/components/recipes/source-label";
import { Label } from "@/components/scrap/paper";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/use-t";

const sentence = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

type Props = { card: Card; names: Record<string, string>; householdId: string };

/** One recipe in the collection: its picture, who wrote it, and what the pantry has for it. */
export function BrowseCard({ card, names, householdId }: Props) {
  const t = useT();
  const words = card.cuisine.replaceAll("_", " ");
  const cuisine = words.charAt(0).toUpperCase() + words.slice(1);
  return (
    <View className="gap-2 rounded-paper bg-card p-2.5 shadow-sm shadow-ink/30">
      <Link href={`/recipe/${card.recipe_id}`} asChild>
        <Pressable
          aria-label={t("cook.card.open", { title: card.title })}
          className="flex-row gap-3"
        >
          {card.image ? (
            <Image
              source={pictureUrl(card.image)}
              style={{ width: 96, height: 72, borderRadius: 2 }}
              contentFit="cover"
              accessibilityLabel={card.title}
            />
          ) : (
            <View style={{ width: 96, height: 72 }} className="rounded-sm bg-paper-deep" />
          )}
          <View className="flex-1 gap-1">
            <Text variant="heading">{card.title}</Text>
            <Text variant="small">
              {t("cook.card.meta", {
                cuisine,
                total: card.time_total_min,
                active: card.time_active_min,
              })}
            </Text>
            <View className="flex-row flex-wrap items-center gap-1.5">
              <SourceLabel source={card.source} />
              {card.has_device_variant ? (
                <Label>
                  <Text variant="label">{t("cook.card.device")}</Text>
                </Label>
              ) : null}
              {card.fits ? (
                <Text className="font-bold text-xs text-ink-soft">
                  {t("cook.card.have", { have: card.have, all: card.have + card.missing.length })}
                </Text>
              ) : (
                <Text className="font-bold text-xs text-tomato">{t("recipes.card.notFit")}</Text>
              )}
            </View>
            {card.missing.length > 0 ? (
              <Text variant="small" numberOfLines={2}>
                {t("cook.card.missing", {
                  items: sentence(card.missing.map((id) => names[id] ?? "")),
                })}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Link>
      {card.missing.length > 0 && card.fits ? (
        <View className="items-end">
          <AddMissing householdId={householdId} recipeId={card.recipe_id} variant="quiet" />
        </View>
      ) : null}
    </View>
  );
}
