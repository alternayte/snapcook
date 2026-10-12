import { Allergen, DietStyle, Effort, type ProfileInput } from "@snapcook/schema";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { Card } from "@/components/scrap/paper";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { type ProfileView, useMatchText } from "@/lib/queries";
import { useT } from "@/lib/use-t";

const SERVINGS_STEP = 0.5;
const TIME_STEP_MIN = 15;

function Section({
  title,
  help,
  children,
  tilt,
}: {
  title: string;
  help?: string;
  children: ReactNode;
  tilt: number;
}) {
  return (
    <Card tilt={tilt} className="gap-3">
      <View className="gap-1">
        <Text variant="heading">{title}</Text>
        {help ? <Text variant="small">{help}</Text> : null}
      </View>
      {children}
    </Card>
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-2">{children}</View>;
}

function Stepper({
  label,
  value,
  onLess,
  onMore,
}: {
  label: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
}) {
  const t = useT();
  return (
    <View className="flex-row items-center justify-between">
      <Text variant="strong">{label}</Text>
      <View className="flex-row items-center gap-3">
        <Button
          variant="paper"
          size="sm"
          onPress={onLess}
          aria-label={`${t("profile.fewer")}: ${label}`}
        >
          <Text>−</Text>
        </Button>
        <Text variant="strong" className="min-w-16 text-center">
          {value}
        </Text>
        <Button
          variant="paper"
          size="sm"
          onPress={onMore}
          aria-label={`${t("profile.more")}: ${label}`}
        >
          <Text>+</Text>
        </Button>
      </View>
    </View>
  );
}

/** Free text about food, read into ingredients the household then confirms by leaving them on. */
function IngredientText({
  placeholder,
  text,
  onText,
  ids,
  onIds,
  names,
  onNames,
}: {
  placeholder: string;
  text: string;
  onText: (text: string) => void;
  ids: string[];
  onIds: (ids: string[]) => void;
  names: Record<string, string>;
  onNames: (names: Record<string, string>) => void;
}) {
  const t = useT();
  const match = useMatchText();
  const [empty, setEmpty] = useState(false);

  async function read() {
    setEmpty(false);
    const { ingredients } = await match.mutateAsync(text);
    setEmpty(ingredients.length === 0);
    onNames({ ...names, ...Object.fromEntries(ingredients.map((i) => [i.id, i.name])) });
    onIds([...new Set([...ids, ...ingredients.map((i) => i.id)])]);
  }

  return (
    <View className="gap-3">
      <Field
        label=""
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChangeText={onText}
        multiline
      />
      <Button
        variant="paper"
        size="sm"
        className="self-start"
        disabled={text.trim() === "" || match.isPending}
        onPress={read}
      >
        <Text>{t("profile.match")}</Text>
      </Button>
      {match.isError ? (
        <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
      ) : null}
      {empty ? <Text variant="small">{t("profile.match.none")}</Text> : null}
      {ids.length > 0 ? (
        <>
          <Text variant="small">{t("profile.match.understood")}</Text>
          <Chips>
            {ids.map((id, index) => (
              <Chip
                key={id}
                index={index}
                selected
                label={names[id] ?? "…"}
                onPress={() => onIds(ids.filter((other) => other !== id))}
              />
            ))}
          </Chips>
        </>
      ) : null}
    </View>
  );
}

type Props = {
  view: ProfileView;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: ProfileInput) => void;
};

/** Every field of the household profile. Onboarding and the household tab both show it. */
export function ProfileForm({ view, submitLabel, busy, onSubmit }: Props) {
  const t = useT();
  const { household_id: _household, allergens, ...rest } = view.profile;
  const [input, setInput] = useState<ProfileInput>({
    ...rest,
    allergens: allergens.map((a) => a.value),
  });
  const [names, setNames] = useState(view.names);
  // Dislikes are stored as ingredients only, so the words typed for them live here.
  const [dislikeText, setDislikeText] = useState("");
  const set = (patch: Partial<ProfileInput>) => setInput((current) => ({ ...current, ...patch }));
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((other) => other !== value) : [...list, value];

  return (
    <View className="gap-7">
      <Section title={t("profile.allergens")} help={t("profile.allergens.help")} tilt={-0.8}>
        <Chips>
          {Allergen.options.map((value, index) => (
            <Chip
              key={value}
              index={index}
              label={t(`allergen.${value}`)}
              selected={input.allergens.includes(value)}
              onPress={() => set({ allergens: toggle(input.allergens, value) })}
            />
          ))}
        </Chips>
      </Section>

      <Section title={t("profile.cannotEat")} help={t("profile.cannotEat.help")} tilt={0.7}>
        <IngredientText
          placeholder={t("profile.cannotEat.placeholder")}
          text={input.cannot_eat_text ?? ""}
          onText={(text) => set({ cannot_eat_text: text === "" ? null : text })}
          ids={input.cannot_eat}
          onIds={(cannot_eat) => set({ cannot_eat })}
          names={names}
          onNames={setNames}
        />
      </Section>

      <Section title={t("profile.dislikes")} help={t("profile.dislikes.help")} tilt={-0.5}>
        <IngredientText
          placeholder={t("profile.dislikes.placeholder")}
          text={dislikeText}
          onText={setDislikeText}
          ids={input.dislikes}
          onIds={(dislikes) => set({ dislikes })}
          names={names}
          onNames={setNames}
        />
      </Section>

      <Section title={t("profile.diet")} tilt={0.9}>
        <Chips>
          {DietStyle.options.map((value, index) => (
            <Chip
              key={value}
              index={index}
              label={t(`diet.${value}`)}
              selected={input.diet_style === value}
              onPress={() => set({ diet_style: value })}
            />
          ))}
        </Chips>
        <Chips>
          <Chip
            label={t("profile.toddler")}
            selected={input.toddler}
            onPress={() => set({ toddler: !input.toddler })}
          />
          <Chip
            index={1}
            label={t("profile.device")}
            selected={input.devices.mc_smart}
            onPress={() => set({ devices: { mc_smart: !input.devices.mc_smart } })}
          />
        </Chips>
        <Text variant="small">{t("profile.toddler.help")}</Text>
        <Text variant="small">{t("profile.device.help")}</Text>
      </Section>

      <Section title={t("profile.effort")} tilt={-0.7}>
        <Stepper
          label={t("profile.servings")}
          value={String(input.default_servings)}
          onLess={() =>
            set({
              default_servings: Math.max(SERVINGS_STEP, input.default_servings - SERVINGS_STEP),
            })
          }
          onMore={() => set({ default_servings: input.default_servings + SERVINGS_STEP })}
        />
        <Stepper
          label={t("profile.time")}
          value={t("profile.time.value", { minutes: input.default_time_min })}
          onLess={() =>
            set({
              default_time_min: Math.max(TIME_STEP_MIN, input.default_time_min - TIME_STEP_MIN),
            })
          }
          onMore={() => set({ default_time_min: input.default_time_min + TIME_STEP_MIN })}
        />
        <Chips>
          {Effort.options.map((value, index) => (
            <Chip
              key={value}
              index={index}
              label={t(`effort.${value}`)}
              selected={input.effort === value}
              onPress={() => set({ effort: value })}
            />
          ))}
        </Chips>
      </Section>

      <Section title={t("profile.staples")} help={t("profile.staples.help")} tilt={0.5}>
        <Chips>
          {view.staple_options.map((staple, index) => (
            <Chip
              key={staple.id}
              index={index}
              label={staple.name}
              selected={input.staples.includes(staple.id)}
              onPress={() => set({ staples: toggle(input.staples, staple.id) })}
            />
          ))}
        </Chips>
      </Section>

      <Button disabled={busy} onPress={() => onSubmit(input)}>
        <Text>{submitLabel}</Text>
      </Button>
    </View>
  );
}
