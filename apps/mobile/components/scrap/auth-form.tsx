import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Card, Page } from "@/components/scrap/paper";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth";
import { useT } from "@/lib/use-t";

const MIN_PASSWORD = 10;

/** The sign-in and sign-up screens: the same card, with a name field when making an account. */
export function AuthForm({ mode }: { mode: "signIn" | "signUp" }) {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const signUp = mode === "signUp";
  const complete =
    email.includes("@") &&
    password.length >= (signUp ? MIN_PASSWORD : 1) &&
    (!signUp || name.trim());

  async function submit() {
    setBusy(true);
    setFailed(false);
    // A refused sign-in comes back as an error value; a dead connection throws. Both show the same.
    const result = await (signUp
      ? authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
      : authClient.signIn.email({ email: email.trim(), password })
    ).catch(() => ({ error: true }));
    setBusy(false);
    if (result.error) return setFailed(true);
    // The answer cached while signed out is dropped, so the next screen waits for the new one.
    client.removeQueries({ queryKey: ["me"] });
    router.replace("/");
  }

  return (
    <Page>
      <View className="h-28">
        <Sticker
          name="tomato"
          size={104}
          angle={8}
          delay={150}
          style={{ position: "absolute", right: 0, top: 0 }}
        />
        <Sticker
          name="garlic"
          size={68}
          angle={-14}
          delay={300}
          style={{ position: "absolute", right: 92, top: 44 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t(`auth.${mode}.title`)}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t(`auth.${mode}.note`)}
        </Text>
      </View>
      <Card tape tilt={-0.6} className="gap-4 pt-6">
        {signUp ? (
          <Field label={t("auth.name")} value={name} onChangeText={setName} autoComplete="name" />
        ) : null}
        <Field
          label={t("auth.email")}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <Field
          label={t("auth.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={signUp ? "new-password" : "current-password"}
          onSubmitEditing={complete ? submit : undefined}
          error={failed ? t(`auth.${mode}.failed`) : undefined}
        />
        {signUp ? <Text variant="small">{t("auth.password.rule")}</Text> : null}
      </Card>
      <Button onPress={submit} disabled={!complete || busy}>
        <Text>{t(`auth.${mode}.submit`)}</Text>
      </Button>
      <Link href={signUp ? "/sign-in" : "/sign-up"} replace asChild>
        <Button variant="quiet">
          <Text>{t(signUp ? "auth.signUp.toSignIn" : "auth.signIn.toSignUp")}</Text>
        </Button>
      </Link>
    </Page>
  );
}
