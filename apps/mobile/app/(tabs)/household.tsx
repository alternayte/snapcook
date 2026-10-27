import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "expo-router";
import { View } from "react-native";
import { DeleteAccount } from "@/components/profile/delete-account";
import { Members } from "@/components/profile/members";
import { ProfileForm } from "@/components/profile/profile-form";
import { Label, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth";
import { useMe, useProfile, useSaveProfile } from "@/lib/queries";
import { useT } from "@/lib/use-t";

function Profile({ householdId }: { householdId: string }) {
  const t = useT();
  const profile = useProfile(householdId);
  const save = useSaveProfile(householdId);
  if (profile.isPending) return <Loading />;
  if (profile.isError) return <Failed onRetry={() => profile.refetch()} />;
  return (
    <>
      <ProfileForm
        // A saved profile comes back with new names; the form starts again from it.
        key={profile.dataUpdatedAt}
        view={profile.data}
        submitLabel={save.isSuccess && !save.isPending ? t("common.saved") : t("common.save")}
        busy={save.isPending}
        onSubmit={(input) => save.mutate(input)}
      />
      {save.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
    </>
  );
}

export default function HouseholdScreen() {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const me = useMe();
  const household = me.data?.household;
  if (!me.data || !household) return <Loading />;

  async function signOut() {
    await authClient.signOut();
    client.clear();
    router.replace("/sign-in");
  }

  return (
    <Page>
      <Label>
        <Text variant="label">{t("household.title")}</Text>
      </Label>
      <View className="gap-1">
        <Text variant="display">{household.name}</Text>
        <Text variant="small">{t("household.signedInAs", { email: me.data.user.email })}</Text>
        <View className="flex-row items-center gap-3 pt-1">
          <Label className="bg-sage">
            <Text variant="label">{t(`plan.${household.plan}`)}</Text>
          </Label>
          {household.plan === "free" ? (
            <Link href="/paywall" asChild>
              <Button variant="quiet" size="sm" className="self-auto">
                <Text>{t("plan.upgrade")}</Text>
              </Button>
            </Link>
          ) : null}
        </View>
      </View>
      <Members
        householdId={household.id}
        userId={me.data.user.id}
        isOwner={me.data.role === "owner"}
      />
      <Profile householdId={household.id} />
      <Button variant="quiet" onPress={signOut}>
        <Text>{t("auth.signOut")}</Text>
      </Button>
      <DeleteAccount isOwner={me.data.role === "owner"} />
    </Page>
  );
}
