import { Image } from "expo-image";
import { Redirect, Tabs } from "expo-router";
import { Failed, Loading } from "@/components/scrap/status";
import { useMe } from "@/lib/queries";
import { COLORS } from "@/lib/theme";
import { useT } from "@/lib/use-t";

const ICON = 30;

const icon = (source: number) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return (
      <Image
        source={source}
        contentFit="contain"
        style={{
          width: ICON,
          height: ICON,
          opacity: focused ? 1 : 0.55,
          transform: [{ rotate: focused ? "-8deg" : "0deg" }],
        }}
      />
    );
  };

export default function TabsLayout() {
  const t = useT();
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.isError) return <Failed onRetry={() => me.refetch()} />;
  if (!me.data) return <Redirect href="/sign-in" />;
  if (!me.data.household) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.ink,
        tabBarInactiveTintColor: COLORS.inkSoft,
        tabBarLabelStyle: { fontFamily: "DMSans_700Bold", fontSize: 12 },
        tabBarStyle: {
          backgroundColor: COLORS.card,
          borderTopColor: COLORS.ink,
          borderTopWidth: 1.5,
          height: 64,
          paddingTop: 6,
        },
      }}
    >
      <Tabs.Screen
        name="pantry"
        options={{
          title: t("tabs.pantry"),
          tabBarIcon: icon(require("@/assets/stickers/tomato.png")),
        }}
      />
      <Tabs.Screen
        name="household"
        options={{
          title: t("tabs.household"),
          tabBarIcon: icon(require("@/assets/stickers/spoon.png")),
        }}
      />
    </Tabs>
  );
}
