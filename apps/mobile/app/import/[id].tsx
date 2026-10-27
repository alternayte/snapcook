import {
  type ImportDraft,
  type ImportLine,
  type ImportView,
  IngredientRole,
  Unit,
} from "@snapcook/schema";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Card, Label, Page } from "@/components/scrap/paper";
import { Failed, Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { useDiscardImport, useImport, useSubmitImport } from "@/lib/recipes";
import { useT } from "@/lib/use-t";

const MAX_SERVINGS = 24;

/** A number typed with a comma or a point; empty or unreadable is null. */
function parseAmount(text: string) {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() === "" || !Number.isFinite(value) || value <= 0
    ? null
    : Math.round(value * 100) / 100;
}

/** Leaves the import screen. The import carries on at the server. */
function useLeave() {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/recipes"));
}

function Waiting({ title, note }: { title: string; note: string }) {
  const t = useT();
  const leave = useLeave();
  return (
    <Page>
      <View className="flex-1 items-center justify-center gap-4 pt-24">
        <Sticker name="pan" size={96} angle={-8} />
        <Text variant="title" className="text-center">
          {title}
        </Text>
        <Text variant="hand" className="text-center">
          {note}
        </Text>
        <Button variant="paper" className="self-center" onPress={leave}>
          <Text>{t("import.leave")}</Text>
        </Button>
      </View>
    </Page>
  );
}

/** A whole number of minutes, typed freely; only a valid number reaches the draft. */
function MinutesField({
  label,
  value,
  onValue,
}: {
  label: string;
  value: number;
  onValue: (minutes: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Field
      label={label}
      value={text}
      keyboardType="number-pad"
      onChangeText={(next) => {
        setText(next);
        const minutes = Math.round(parseAmount(next) ?? 0);
        if (minutes > 0) onValue(minutes);
      }}
    />
  );
}

type LineProps = {
  line: ImportLine;
  isNew: boolean;
  onChange: (patch: Partial<ImportLine>) => void;
  onRemove: () => void;
};

function LineEditor({ line, isNew, onChange, onRemove }: LineProps) {
  const t = useT();
  const [amount, setAmount] = useState(line.quantity === null ? "" : String(line.quantity));
  return (
    <View className="gap-2 border-b border-b-hairline border-ink/30 py-3">
      <View className="flex-row items-end gap-2">
        <View className="w-24">
          <Field
            label={t("import.ingredient.amount")}
            value={amount}
            keyboardType="decimal-pad"
            onChangeText={(text) => {
              setAmount(text);
              const quantity = parseAmount(text);
              onChange({ quantity, unit: quantity === null ? null : (line.unit ?? "g") });
            }}
          />
        </View>
        <View className="flex-1">
          <Field
            label={t("import.ingredient.name")}
            value={line.name}
            onChangeText={(name) => onChange({ name })}
            maxLength={80}
          />
        </View>
      </View>
      {isNew ? (
        <Text className="font-bold text-xs text-tomato">{t("import.ingredient.new")}</Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
      >
        <Chip
          label={t("import.unit.none")}
          selected={line.unit === null}
          onPress={() => {
            setAmount("");
            onChange({ quantity: null, unit: null });
          }}
        />
        {Unit.options.map((unit, index) => (
          <Chip
            key={unit}
            index={index + 1}
            label={unit}
            selected={line.unit === unit}
            onPress={() => onChange({ unit, quantity: line.quantity ?? parseAmount(amount) ?? 1 })}
          />
        ))}
      </ScrollView>
      <Field
        label={t("import.ingredient.prep")}
        value={line.prep ?? ""}
        onChangeText={(prep) => onChange({ prep: prep.trim() === "" ? null : prep })}
        maxLength={120}
      />
      <View className="flex-row flex-wrap items-center gap-2">
        {IngredientRole.options.map((role, index) => (
          <Chip
            key={role}
            index={index}
            label={t(`import.role.${role}`)}
            selected={line.role === role}
            onPress={() => onChange({ role })}
          />
        ))}
        <Button variant="quiet" size="sm" className="self-auto" onPress={onRemove}>
          <Text>{t("import.ingredient.remove")}</Text>
        </Button>
      </View>
    </View>
  );
}

function Check({ view }: { view: ImportView & { draft: ImportDraft } }) {
  const t = useT();
  const leave = useLeave();
  const submit = useSubmitImport(view.id, leave);
  const discard = useDiscardImport(view.id);
  const { ingredients: firstLines, steps: firstSteps, ...firstFields } = view.draft;
  const [fields, setFields] = useState(firstFields);
  // Each line and step has its own key, so its editor stays put while others come and go. A
  // renamed line is matched again by the server, so "new" no longer applies to it.
  const [lines, setLines] = useState(() =>
    firstLines.map((line, i) => ({ key: `line-${i}`, renamed: false, line })),
  );
  const [steps, setSteps] = useState(() =>
    firstSteps.map((step, i) => ({ key: `step-${i}`, step })),
  );
  const counter = useRef(0);
  const fresh = () => {
    counter.current += 1;
    return `new-${counter.current}`;
  };
  const set = (patch: Partial<typeof fields>) => setFields((current) => ({ ...current, ...patch }));
  const setLine = (key: string, patch: Partial<ImportLine>) =>
    setLines((list) =>
      list.map((item) =>
        item.key === key
          ? {
              ...item,
              renamed: item.renamed || patch.name !== undefined,
              line: { ...item.line, ...patch },
            }
          : item,
      ),
    );
  const draft: ImportDraft = {
    ...fields,
    ingredients: lines.map((item) => item.line),
    steps: steps.map((item) => item.step),
  };
  const ready =
    draft.title.trim() !== "" &&
    draft.ingredients.length > 0 &&
    draft.ingredients.every((l) => l.name.trim() !== "") &&
    draft.steps.length > 0 &&
    draft.steps.every((s) => s.text.trim() !== "");

  return (
    <Page>
      <View className="gap-1">
        <Text variant="display">
          {view.editing ? t("import.edit.title") : t("import.check.title")}
        </Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("import.check.note")}
        </Text>
      </View>

      {view.status === "failed" && view.error ? (
        <Card tilt={0.6} className="gap-1 bg-mustard">
          <Text variant="strong">{t(`import.failed.${view.error}`)}</Text>
          {view.problems.map((problem) => (
            <Text key={problem}>• {problem}</Text>
          ))}
        </Card>
      ) : null}

      <Card tape tilt={-0.5} className="gap-4 pt-6">
        <Field
          label={t("import.field.title")}
          value={fields.title}
          onChangeText={(title) => set({ title })}
          maxLength={120}
        />
        <View className="flex-row items-center justify-between">
          <Text variant="label">{t("import.field.servings")}</Text>
          <View className="flex-row items-center gap-3">
            <Button
              variant="paper"
              size="sm"
              className="self-auto"
              aria-label={`${t("profile.fewer")}: ${t("import.field.servings")}`}
              onPress={() => set({ servings: Math.max(1, fields.servings - 1) })}
            >
              <Text>−</Text>
            </Button>
            <Text variant="strong" className="min-w-10 text-center">
              {fields.servings}
            </Text>
            <Button
              variant="paper"
              size="sm"
              className="self-auto"
              aria-label={`${t("profile.more")}: ${t("import.field.servings")}`}
              onPress={() => set({ servings: Math.min(MAX_SERVINGS, fields.servings + 1) })}
            >
              <Text>+</Text>
            </Button>
          </View>
        </View>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <MinutesField
              label={t("import.field.total")}
              value={fields.time_total_min}
              onValue={(minutes) => set({ time_total_min: minutes })}
            />
          </View>
          <View className="flex-1">
            <MinutesField
              label={t("import.field.active")}
              value={fields.time_active_min}
              onValue={(minutes) => set({ time_active_min: minutes })}
            />
          </View>
        </View>
        <View className="gap-2">
          <Text variant="label">{t("import.field.cuisine")}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 py-1"
          >
            {view.choices.cuisine.map((cuisine, index) => {
              const words = cuisine.replaceAll("_", " ");
              return (
                <Chip
                  key={cuisine}
                  index={index}
                  label={words.charAt(0).toUpperCase() + words.slice(1)}
                  selected={fields.cuisine === cuisine}
                  onPress={() => set({ cuisine })}
                />
              );
            })}
          </ScrollView>
        </View>
      </Card>

      <Card tilt={0.5} className="gap-1">
        <Label>
          <Text variant="label">{t("import.ingredients")}</Text>
        </Label>
        {lines.map((item) => (
          <LineEditor
            key={item.key}
            line={item.line}
            isNew={item.line.ingredient_id === null && !item.renamed}
            onChange={(patch) => setLine(item.key, patch)}
            onRemove={() => setLines((list) => list.filter((other) => other.key !== item.key))}
          />
        ))}
        <Button
          variant="paper"
          size="sm"
          className="mt-2 self-start"
          onPress={() =>
            setLines((list) => [
              ...list,
              {
                key: fresh(),
                renamed: false,
                line: {
                  name: "",
                  ingredient_id: null,
                  quantity: null,
                  unit: null,
                  prep: null,
                  role: "supporting",
                },
              },
            ])
          }
        >
          <Text>{t("import.ingredient.add")}</Text>
        </Button>
      </Card>

      <Card tilt={-0.4} className="gap-3">
        <Label className="bg-sage">
          <Text variant="label">{t("import.steps")}</Text>
        </Label>
        {steps.map((item, index) => (
          <View key={item.key} className="gap-1">
            <Field
              label={t("import.step.label", { number: index + 1 })}
              value={item.step.text}
              multiline
              className="min-h-20 py-2"
              onChangeText={(text) =>
                setSteps((list) =>
                  list.map((other) =>
                    other.key === item.key ? { ...other, step: { ...other.step, text } } : other,
                  ),
                )
              }
              maxLength={1000}
            />
            <Button
              variant="quiet"
              size="sm"
              className="self-end"
              onPress={() => setSteps((list) => list.filter((other) => other.key !== item.key))}
            >
              <Text>{t("import.step.remove")}</Text>
            </Button>
          </View>
        ))}
        <Button
          variant="paper"
          size="sm"
          className="self-start"
          onPress={() =>
            setSteps((list) => [
              ...list,
              { key: fresh(), step: { text: "", kind: "prep", lane: "main" } },
            ])
          }
        >
          <Text>{t("import.step.add")}</Text>
        </Button>
      </Card>

      {submit.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
      <Button disabled={!ready || submit.isPending} onPress={() => submit.mutate(draft)}>
        <Text>{view.editing ? t("import.save.edit") : t("import.save")}</Text>
      </Button>
      <Button
        variant="quiet"
        disabled={discard.isPending}
        onPress={() => discard.mutate(undefined, { onSuccess: leave })}
      >
        <Text>{t("import.discard")}</Text>
      </Button>
    </Page>
  );
}

export default function ImportScreen() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const view = useImport(id);
  const discard = useDiscardImport(id);
  const leave = useLeave();
  const client = useQueryClient();
  const done = view.data?.status === "done" ? view.data.recipe_id : null;
  // A saved recipe or edit must show as it now is, wherever it was kept.
  useEffect(() => {
    if (!done) return;
    client.invalidateQueries({ queryKey: ["recipe", done] });
    client.invalidateQueries({ queryKey: ["browse"] });
    client.invalidateQueries({ queryKey: ["adaptation"] });
  }, [done, client]);
  if (view.isError) return <Failed onRetry={() => view.refetch()} />;
  if (!view.data) return <Loading />;
  const { data } = view;
  if (data.status === "done" && data.recipe_id)
    return <Redirect href={`/recipe/${data.recipe_id}`} />;
  if (data.status === "reading") {
    return <Waiting title={t("import.reading")} note={t("import.reading.note")} />;
  }
  if (data.status === "saving") {
    return <Waiting title={t("import.saving")} note={t("import.saving.note")} />;
  }
  if (data.draft) return <Check view={{ ...data, draft: data.draft }} />;
  // Failed before anything was read: there is nothing to check.
  return (
    <Page>
      <View className="items-center gap-4 pt-16">
        <Sticker name="lemon" size={88} angle={12} />
        <Text className="text-center">{t(`import.failed.${data.error ?? "read_failed"}`)}</Text>
        <Button
          variant="paper"
          className="self-center"
          disabled={discard.isPending}
          onPress={() =>
            discard.mutate(undefined, { onSuccess: () => router.replace("/import/new") })
          }
        >
          <Text>{t("import.again")}</Text>
        </Button>
        <Button
          variant="quiet"
          className="self-center"
          disabled={discard.isPending}
          onPress={() => discard.mutate(undefined, { onSuccess: leave })}
        >
          <Text>{t("import.discard")}</Text>
        </Button>
      </View>
    </Page>
  );
}
