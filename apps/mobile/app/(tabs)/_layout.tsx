import { Redirect, Tabs } from "expo-router";
import { ChefHat, House, type LucideIcon, Refrigerator, ShoppingBasket } from "lucide-react-native";
import type { ColorValue } from "react-native";
import { Failed, Loading } from "@/components/scrap/status";
import { useHouseholdSync } from "@/lib/queries";
import { COLORS } from "@/lib/theme";
import { useT } from "@/lib/use-t";

const ICON = 24;

// Line icons, drawn slightly heavier when the tab is open.
const icon = (Icon: LucideIcon) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon size={ICON} color={String(color)} strokeWidth={focused ? 2.5 : 1.75} />;
  };

export default function TabsLayout() {
  const t = useT();
  const me = useHouseholdSync();
  if (me.isPending) return <Loading />;
  if (me.isError) return <Failed onRetry={() => me.refetch()} />;
  if (!me.data) return <Redirect href="/sign-in" />;
  if (!me.data.household) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.tomato,
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
          tabBarIcon: icon(Refrigerator),
        }}
      />
      <Tabs.Screen name="cook" options={{ title: t("tabs.cook"), tabBarIcon: icon(ChefHat) }} />
      <Tabs.Screen
        name="list"
        options={{ title: t("tabs.list"), tabBarIcon: icon(ShoppingBasket) }}
      />
      <Tabs.Screen
        name="household"
        options={{
          title: t("tabs.household"),
          tabBarIcon: icon(House),
        }}
      />
    </Tabs>
  );
}
