import { Link } from "expo-router";
import { Pressable, View } from "react-native";
import { Card, Label } from "@/components/scrap/paper";
import { Text } from "@/components/ui/text";
import { useImports } from "@/lib/recipes";
import { useT } from "@/lib/use-t";

/** The imports still on their way to becoming recipes. Each opens to check it or to see why it failed. */
export function OpenImports() {
  const t = useT();
  const imports = useImports();
  if (!imports.data || imports.data.length === 0) return null;
  return (
    <Card tilt={0.4} className="gap-0">
      <Label className="bg-mustard">
        <Text variant="label">{t("imports.title")}</Text>
      </Label>
      {imports.data.map((item, index) => (
        <Link key={item.id} href={`/import/${item.id}`} asChild>
          <Pressable
            className={`flex-row items-center justify-between gap-3 py-2.5 ${index > 0 ? "border-t border-t-hairline border-ink/30" : ""}`}
          >
            <Text variant="strong" className="flex-1">
              {item.title ?? t("imports.untitled")}
            </Text>
            <View className="items-end">
              <Text
                className={
                  item.status === "checking" || item.status === "failed"
                    ? "font-bold text-sm text-tomato"
                    : "font-medium text-sm text-ink-soft"
                }
              >
                {t(`imports.status.${item.status}`)}
              </Text>
            </View>
          </Pressable>
        </Link>
      ))}
    </Card>
  );
}
