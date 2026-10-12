import { useState } from "react";
import { View } from "react-native";
import { Card } from "@/components/scrap/paper";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { useRescue } from "@/lib/cook";
import { useT } from "@/lib/use-t";

const MIN_LENGTH = 3;

/** "Something's off": the cook says what they see and gets one thing to do about it. */
export function Rescue({ cookId, stepIndex }: { cookId: string; stepIndex: number }) {
  const t = useT();
  const rescue = useRescue(cookId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <Button variant="quiet" onPress={() => setOpen(true)}>
        <Text>{t("cooking.off")}</Text>
      </Button>
    );
  }
  return (
    <Card tilt={0.5} className="gap-3">
      <Field
        label={t("cooking.off.label")}
        placeholder={t("cooking.off.placeholder")}
        value={text}
        onChangeText={setText}
        maxLength={300}
        error={rescue.isError ? t("common.error") : undefined}
      />
      <Button
        variant="paper"
        size="sm"
        className="self-start"
        disabled={text.trim().length < MIN_LENGTH || rescue.isPending}
        onPress={() => rescue.mutate({ step_index: stepIndex, text: text.trim() })}
      >
        <Text>{t("cooking.off.ask")}</Text>
      </Button>
      {rescue.data ? (
        <View className="gap-1 rounded-paper bg-paper p-3">
          <Text className="font-medium text-lg">{rescue.data.answer}</Text>
          {rescue.data.source === "known_fix" ? (
            <Text variant="hand">{t("cooking.off.known")}</Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
