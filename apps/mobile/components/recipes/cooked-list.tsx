import { Image } from "expo-image";
import { Link } from "expo-router";
import { useIntl } from "react-intl";
import { Pressable, View } from "react-native";
import { pictureUrl } from "@/components/cook/result-card";
import { Card, Label } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { type CookedRow, useCookHistory } from "@/lib/cook";
import { useT } from "@/lib/use-t";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight of the Monday that starts the week a moment falls in, in local time. */
function weekOf(at: Date) {
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const sinceMonday = (day.getDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS).getTime();
}

function Row({ cook }: { cook: CookedRow }) {
  const t = useT();
  const intl = useIntl();
  return (
    <Link href={`/cook/${cook.id}`} asChild>
      <Pressable className="flex-row items-center gap-3 border-b border-b-hairline border-ink/30 py-2.5">
        {cook.image ? (
          <Image
            source={pictureUrl(cook.image)}
            style={{ width: 56, height: 42, borderRadius: 2 }}
            contentFit="cover"
          />
        ) : (
          <View style={{ width: 56, height: 42 }} className="rounded-sm bg-paper-deep" />
        )}
        <View className="flex-1 gap-0.5">
          <Text variant="strong">{cook.title}</Text>
          <Text variant="small">
            {t("cooked.by", {
              date: intl.formatDate(cook.started_at, {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
              cook: cook.cook,
            })}
          </Text>
        </View>
        <View className="items-end gap-1">
          {cook.rating ? (
            <Text className="font-bold text-sm text-tomato">{"★".repeat(cook.rating)}</Text>
          ) : null}
          {cook.machine ? (
            <Text className="font-bold text-xs text-ink-soft">{t("cooked.machine")}</Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

/** Every cook at a glance: the unfinished first, then the finished by week, newest first. */
export function CookedList() {
  const t = useT();
  const intl = useIntl();
  const cooks = useCookHistory();
  if (cooks.isPending) return <Loading />;
  if (cooks.isError) return <Failed onRetry={() => cooks.refetch()} />;
  if (cooks.data.length === 0) {
    return (
      <Text variant="hand" className="text-center">
        {t("cooked.empty")}
      </Text>
    );
  }

  const open = cooks.data.filter((cook) => !cook.finished_at);
  const done = cooks.data.filter((cook) => cook.finished_at);
  const now = new Date();
  const thisMonth = done.filter((cook) => {
    const at = new Date(cook.started_at);
    return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
  });
  const counts = new Map<string, { title: string; n: number }>();
  for (const cook of done) {
    const seen = counts.get(cook.recipe_id);
    counts.set(cook.recipe_id, { title: cook.title, n: (seen?.n ?? 0) + 1 });
  }
  const most = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  const weeks = new Map<number, CookedRow[]>();
  for (const cook of done) {
    const week = weekOf(new Date(cook.started_at));
    weeks.set(week, [...(weeks.get(week) ?? []), cook]);
  }
  const current = weekOf(now);
  const weekName = (week: number) =>
    week === current
      ? t("cooked.week.this")
      : week === current - 7 * DAY_MS
        ? t("cooked.week.last")
        : t("cooked.week.of", { date: intl.formatDate(week, { day: "numeric", month: "short" }) });

  return (
    <View className="gap-5">
      <View className="gap-0.5">
        <Text variant="title">{t("cooked.stats", { count: thisMonth.length })}</Text>
        {most && most.n > 1 ? (
          <Text variant="small">{t("cooked.stats.most", { title: most.title })}</Text>
        ) : null}
      </View>
      {open.map((cook) => (
        <Card key={cook.id} tilt={0.6} className="gap-2 bg-mustard">
          <Text variant="heading">{cook.title}</Text>
          <Link href={`/cook/${cook.id}`} asChild>
            <Button variant="paper" size="sm" className="self-start">
              <Text>{t("cooked.carryOn")}</Text>
            </Button>
          </Link>
        </Card>
      ))}
      {[...weeks].map(([week, list], index) => (
        <Card key={week} tilt={index % 2 === 0 ? -0.4 : 0.4} className="gap-0">
          <Label className={index % 2 === 0 ? "bg-sage" : "bg-mustard"}>
            <Text variant="label">{weekName(week)}</Text>
          </Label>
          {list.map((cook) => (
            <Row key={cook.id} cook={cook} />
          ))}
        </Card>
      ))}
    </View>
  );
}
