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
import {
  useCreateHousehold,
  useJoinHousehold,
  useMe,
  useProfile,
  useSaveProfile,
} from "@/lib/queries";
import { useSetMachine } from "@/lib/recipes";
import { useT } from "@/lib/use-t";

function NameHousehold() {
  const t = useT();
  const create = useCreateHousehold();
  const [name, setName] = useState("");
  const join = useJoinHousehold();
  const [code, setCode] = useState("");
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
      <Card tilt={0.6} className="gap-3">
        <View className="gap-1">
          <Text variant="heading">{t("onboarding.join.title")}</Text>
          <Text variant="small">{t("onboarding.join.help")}</Text>
        </View>
        <Field
          label={t("onboarding.join.code")}
          value={code}
          onChangeText={(next) => setCode(next.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          error={join.isError ? t("onboarding.join.failed") : undefined}
        />
        <Button
          variant="paper"
          disabled={code.trim().length !== 6 || join.isPending}
          onPress={() => join.mutate(code.trim())}
        >
          <Text>{t("onboarding.join.submit")}</Text>
        </Button>
      </Card>
    </Page>
  );
}

/** One question on its own: whether the household has the machine, so recipes can use it. */
function MachineQuestion({ householdId, onAnswer }: { householdId: string; onAnswer: () => void }) {
  const t = useT();
  const machine = useSetMachine(householdId);
  const answer = (has: boolean) => machine.mutate(has, { onSuccess: onAnswer });
  return (
    <Page>
      <View className="h-24">
        <Sticker
          name="spoon"
          size={96}
          angle={12}
          delay={150}
          style={{ position: "absolute", right: 8, top: 0 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("onboarding.machine.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("onboarding.machine.note")}
        </Text>
      </View>
      <Button disabled={machine.isPending} onPress={() => answer(true)}>
        <Text>{t("onboarding.machine.yes")}</Text>
      </Button>
      <Button variant="paper" disabled={machine.isPending} onPress={() => answer(false)}>
        <Text>{t("onboarding.machine.no")}</Text>
      </Button>
      {machine.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
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
  const [askedMachine, setAskedMachine] = useState(false);
  if (me.isPending) return <Loading />;
  if (me.isError) return <Failed onRetry={() => me.refetch()} />;
  if (!me.data) return <Redirect href="/sign-in" />;
  if (!me.data.household) return <NameHousehold />;
  if (!startedWithout) return <Redirect href="/(tabs)/pantry" />;
  if (!askedMachine) {
    return (
      <MachineQuestion householdId={me.data.household.id} onAnswer={() => setAskedMachine(true)} />
    );
  }
  return <FirstProfile householdId={me.data.household.id} />;
}
