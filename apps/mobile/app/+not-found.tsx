import { Link, Stack } from "expo-router";
import { useIntl } from "react-intl";
import { View } from "react-native";
import { Text } from "@/components/ui/text";

export default function NotFoundScreen() {
  const intl = useIntl();

  return (
    <>
      <Stack.Screen options={{ title: intl.formatMessage({ id: "notFound.title" }) }} />
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text>{intl.formatMessage({ id: "notFound.body" })}</Text>
        <Link href="/">
          <Text className="underline">{intl.formatMessage({ id: "notFound.home" })}</Text>
        </Link>
      </View>
    </>
  );
}
