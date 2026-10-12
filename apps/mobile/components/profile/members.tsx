import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { Card, Label } from "@/components/scrap/paper";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useInvite, useMembers, useRemoveMember } from "@/lib/queries";
import { useT } from "@/lib/use-t";

type Props = { householdId: string; userId: string; isOwner: boolean };

/** Who shares the household, with a way to invite, remove or leave. */
export function Members({ householdId, userId, isOwner }: Props) {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const members = useMembers(householdId);
  const invite = useInvite();
  const remove = useRemoveMember(householdId);

  const leave = () =>
    remove.mutate(userId, {
      // A person with no household starts again at the first screen.
      onSuccess: () => {
        client.removeQueries({ queryKey: ["me"] });
        router.replace("/");
      },
    });

  return (
    <Card tilt={-0.5} className="gap-2">
      <Label className="bg-sage">
        <Text variant="label">{t("members.title")}</Text>
      </Label>
      {(members.data ?? []).map((member) => (
        <View
          key={member.user_id}
          className="flex-row items-center gap-3 border-b border-b-hairline border-ink/30 py-2"
        >
          <View className="flex-1">
            <Text variant="strong">{member.name}</Text>
            <Text variant="small">
              {[
                member.role === "owner" ? t("members.owner") : "",
                member.user_id === userId ? t("members.you") : "",
              ]
                .filter(Boolean)
                .join(" · ") || member.email}
            </Text>
          </View>
          {isOwner && member.role !== "owner" ? (
            <Button
              variant="quiet"
              size="sm"
              className="self-auto"
              disabled={remove.isPending}
              onPress={() => remove.mutate(member.user_id)}
            >
              <Text>{t("members.remove", { name: member.name })}</Text>
            </Button>
          ) : null}
        </View>
      ))}
      {invite.data ? (
        <View className="items-center gap-1 rounded-paper bg-paper p-4">
          <Text className="font-display text-3xl tracking-widest" selectable>
            {invite.data.code}
          </Text>
          <Text variant="small" className="text-center">
            {t("members.invite.code")}
          </Text>
        </View>
      ) : null}
      <Button
        variant="paper"
        size="sm"
        className="mt-2 self-start"
        disabled={invite.isPending}
        onPress={() => invite.mutate()}
      >
        <Text>{t("members.invite")}</Text>
      </Button>
      {isOwner ? null : (
        <Button
          variant="quiet"
          size="sm"
          className="self-start"
          disabled={remove.isPending}
          onPress={leave}
        >
          <Text>{t("members.leave")}</Text>
        </Button>
      )}
      {invite.isError || remove.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
    </Card>
  );
}
