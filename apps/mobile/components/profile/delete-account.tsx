import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Card } from "@/components/scrap/paper";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { ApiError, api, unwrap } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { useT } from "@/lib/use-t";

/** Deletes the signed-in person's account, after one confirmation. */
export function DeleteAccount({ isOwner }: { isOwner: boolean }) {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => unwrap<undefined>(api.me.$delete()),
    onSuccess: async () => {
      // The server has ended the session already; this clears what the phone kept of it.
      await authClient.signOut().catch(() => undefined);
      client.clear();
      router.replace("/sign-in");
    },
  });
  const hasMembers =
    remove.error instanceof ApiError && remove.error.details?.reason === "has_members";

  if (!asking) {
    return (
      <Button variant="quiet" onPress={() => setAsking(true)}>
        <Text>{t("account.delete")}</Text>
      </Button>
    );
  }
  return (
    <Card tilt={-0.4} className="gap-3 bg-mustard">
      <Text variant="strong">{t("account.delete")}</Text>
      <Text>{isOwner ? t("account.delete.owner") : t("account.delete.member")}</Text>
      {remove.isError ? (
        <Text className="font-medium text-sm text-tomato">
          {hasMembers ? t("account.delete.hasMembers") : t("common.error")}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-3">
        <Button
          variant="paper"
          className="self-auto"
          disabled={remove.isPending}
          onPress={() => remove.mutate()}
        >
          <Text>{t("account.delete.submit")}</Text>
        </Button>
        <Button
          variant="quiet"
          className="self-auto"
          onPress={() => {
            remove.reset();
            setAsking(false);
          }}
        >
          <Text>{t("common.cancel")}</Text>
        </Button>
      </View>
    </Card>
  );
}
