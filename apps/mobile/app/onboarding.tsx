import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ProfileForm } from "@/components/profile/profile-form";
import { Card, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { useCreateHousehold, useMe, useProfile, useSaveProfile } from "@/lib/queries";
import { useT } from "@/lib/use-t";

function NameHousehold() {
  const t = useT();
  const create = useCreateHousehold();
  const [name, setName] = useState("");
  return (
    <Page>
      <View className="h-24">
        <Sticker
          name="pan"
          size={96}
          angle={-10}
          delay={150}
          style={{ position: "absolute", right: 8, top: 0 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("onboarding.household.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("onboarding.household.note")}
        </Text>
      </View>
      <Card tape className="pt-6">
        <Field
          label={t("onboarding.household.name")}
          placeholder={t("onboarding.household.placeholder")}
          value={name}
          onChangeText={setName}
          error={create.isError ? t("common.error") : undefined}
        />
      </Card>
      <Button
        disabled={name.trim() === "" || create.isPending}
        onPress={() => create.mutate(name.trim())}
      >
        <Text>{t("onboarding.household.submit")}</Text>
      </Button>
    </Page>
  );
}

function FirstProfile({ householdId }: { householdId: string }) {
  const t = useT();
  const router = useRouter();
  const profile = useProfile(householdId);
  const save = useSaveProfile(householdId);
  if (profile.isPending) return <Loading />;
  if (profile.isError) return <Failed onRetry={() => profile.refetch()} />;
  return (
    <Page>
      <View className="gap-1">
        <Text variant="display">{t("onboarding.profile.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("onboarding.profile.note")}
        </Text>
      </View>
      <ProfileForm
        view={profile.data}
        submitLabel={t("onboarding.profile.submit")}
        busy={save.isPending}
        onSubmit={(input) =>
          save.mutate(input, { onSuccess: () => router.replace("/(tabs)/pantry") })
        }
      />
      {save.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
    </Page>
  );
}

/** First run: name the household, then set its profile once. */
export default function Onboarding() {
  const me = useMe();
  // The household exists from the first step on, so its id decides which step shows.
  const [startedWithout] = useState(() => me.data?.household == null);
  if (me.isPending) return <Loading />;
  if (me.isError) return <Failed onRetry={() => me.refetch()} />;
  if (!me.data) return <Redirect href="/sign-in" />;
  if (!me.data.household) return <NameHousehold />;
  if (!startedWithout) return <Redirect href="/(tabs)/pantry" />;
  return <FirstProfile householdId={me.data.household.id} />;
}
