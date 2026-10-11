import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useIntl } from "react-intl";
import { ActivityIndicator, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";

export default function HomeScreen() {
  const intl = useIntl();
  const health = useQuery({
    queryKey: ["healthz"],
    queryFn: async () => {
      const res = await api.api.v1.healthz.$get();
      if (!res.ok) throw new Error(`healthz answered ${res.status}`);
      return res.json();
    },
    retry: false,
  });

  return (
    <>
      <Stack.Screen options={{ title: intl.formatMessage({ id: "app.name" }) }} />
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        {health.isPending ? (
          <>
            <ActivityIndicator />
            <Text className="text-muted-foreground">
              {intl.formatMessage({ id: "home.api.checking" })}
            </Text>
          </>
        ) : health.isError ? (
          <>
            <Text className="text-destructive">{intl.formatMessage({ id: "home.api.down" })}</Text>
            <Button variant="outline" onPress={() => health.refetch()}>
              <Text>{intl.formatMessage({ id: "home.api.retry" })}</Text>
            </Button>
          </>
        ) : (
          <Text>{intl.formatMessage({ id: "home.api.ok" })}</Text>
        )}
      </View>
    </>
  );
}
