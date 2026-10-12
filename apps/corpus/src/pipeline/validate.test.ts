import { expect, test } from "bun:test";
import type {
  DeviceCapabilities,
  DeviceVariantDraft,
  DraftIngredient,
  Ingredient,
  RecipeDraft,
} from "@snapcook/schema";
import { indexIngredients, validateDraft, validateVariant } from "./validate";

const ingredient = (
  name: string,
  category: Ingredient["category"],
  over: Partial<Ingredient> = {},
): Ingredient => ({
  id: name,
  name,
  aliases: [],
  category,
  allergens: [],
  contains: [],
  default_unit: "g",
  grams_per_unit: null,
  ml_per_unit: null,
  is_staple_default: false,
  embedding: null,
  ...over,
});

const index = indexIngredients([
  ingredient("chicken thigh", "poultry", { aliases: ["chicken thighs"] }),
  ingredient("leek", "vegetable", { default_unit: "piece", grams_per_unit: 200 }),
  ingredient("olive oil", "oil_fat", { ml_per_unit: 1.09 }),
  ingredient("salt", "spice"),
]);

const config = {
  tags: ["one-pot"],
  edible_share: {} as Record<string, number>,
  bands: [
    {
      label: "Meat and fish",
      categories: ["poultry"],
      roles: ["core"],
      dish_proteins: ["chicken_thigh"],
      dish_types: [],
      min_g: 100,
      max_g: 250,
    },
  ],
};

const chicken: DraftIngredient = {
  ingredient: "Chicken Thighs",
  quantity: 600,
  unit: "g",
  prep: null,
  role: "core",
  substitutes: [],
};
const leek: DraftIngredient = {
  ingredient: "leek",
  quantity: 2,
  unit: "piece",
  prep: null,
  role: "supporting",
  substitutes: [],
};
const salt: DraftIngredient = {
  ingredient: "salt",
  quantity: null,
  unit: null,
  prep: null,
  role: "staple",
  substitutes: [],
};
const cut = { index: 0, lane: "main", kind: "prep", text: "Cut.", minutes: 10 } as const;
const braise = { index: 1, lane: "main", kind: "pan", text: "Braise.", minutes: 40 } as const;

const good: RecipeDraft = {
  title: "Braised Chicken",
  description: "A braise.",
  time_total_min: 50,
  time_active_min: 15,
  difficulty: 1,
  ingredients: [chicken, leek, salt],
  steps: [cut, braise],
  tags: ["one-pot"],
  failure_modes: [],
};
const dish = { primary_protein: "chicken_thigh", dish_type: "main" };
const codes = (draft: RecipeDraft) => validateDraft(draft, dish, index, config).map((p) => p.code);

test("a sound draft has no problems, and an alias counts as a known name", () => {
  expect(codes(good)).toEqual([]);
});

test.each([
  [
    "an unlisted ingredient",
    { ingredients: [{ ...chicken, ingredient: "poularde" }] },
    "unknown_ingredient",
  ],
  ["no core ingredient", { ingredients: [leek] }, "no_core"],
  [
    "a quantity with no unit",
    { ingredients: [chicken, { ...salt, quantity: 1 }] },
    "quantity_unit",
  ],
  ["40 g of meat per serving", { ingredients: [{ ...chicken, quantity: 160 }] }, "quantity_band"],
  [
    "a device step in the generic recipe",
    { steps: [cut, { ...braise, kind: "mc" as const }] },
    "device_step",
  ],
  ["steps that do not add up to the total time", { time_total_min: 120 }, "time_total"],
  ["a tag outside the allowed list", { tags: ["quick"] }, "unknown_tag"],
] as const)("%s is reported", (_name, change, code) => {
  expect(codes({ ...good, ...change } as RecipeDraft)).toContain(code);
});

const device: DeviceCapabilities = {
  temp_c: { min: 0, max: 130 },
  speed: { min: 0, max: 10 },
  reverse_max_speed: 3,
  whisk_max_speed: 4,
  time_limits: [
    { up_to_speed: 6, max_minutes: 99 },
    { up_to_speed: 10, max_minutes: 10 },
  ],
  bowl_max_fill_ml: 3000,
  high_speed_max_liquid_ml: 2500,
  scale: { max_g: 5000, step_g: 5 },
  accessories: [],
  programs: {},
};
const mcStep = (mc: NonNullable<DeviceVariantDraft["steps"][number]["mc"]>) =>
  ({ index: 0, lane: "main", kind: "mc", text: "Cook.", minutes: mc.minutes, mc }) as const;
const variantCodes = (mc: Parameters<typeof mcStep>[0]) =>
  validateVariant({ suitability: "native", notes: "n", steps: [mcStep(mc)] }, device).map(
    (p) => p.code,
  );

test("device settings inside the limits pass", () => {
  expect(variantCodes({ temp_c: 100, minutes: 25, speed: 1, reverse: true })).toEqual([]);
});

test.each([
  ["140 °C", { temp_c: 140, minutes: 5, speed: 1, reverse: false }, "device_temp"],
  ["reverse at speed 5", { temp_c: 100, minutes: 5, speed: 5, reverse: true }, "device_reverse"],
  [
    "the whisk at speed 6",
    { temp_c: 0, minutes: 2, speed: 6, reverse: false, accessory: "butterfly" as const },
    "device_whisk",
  ],
  ["15 minutes at speed 8", { temp_c: 0, minutes: 15, speed: 8, reverse: false }, "device_time"],
] as const)("%s is reported", (_name, mc, code) => {
  expect(variantCodes(mc)).toContain(code);
});

test("a suitable dish with no device step is reported", () => {
  const variant: DeviceVariantDraft = { suitability: "partial", notes: "n", steps: [] };
  expect(validateVariant(variant, device).map((p) => p.code)).toEqual(["no_device_step"]);
});

test("an oven step with no minutes in a device variant is reported", () => {
  const variant: DeviceVariantDraft = {
    suitability: "partial",
    notes: "n",
    steps: [
      mcStep({ temp_c: 100, minutes: 10, speed: 1, reverse: true }),
      { index: 1, lane: "main", kind: "oven", text: "Bake." },
    ],
  };
  expect(validateVariant(variant, device).map((p) => p.code)).toEqual(["missing_minutes"]);
});

test("a quantity band applies only to its dish types", () => {
  const thin = { ...good, ingredients: [{ ...chicken, quantity: 160 }] };
  const mains = { ...config, bands: config.bands.map((b) => ({ ...b, dish_types: ["main"] })) };
  const codesFor = (dish_type: string) =>
    validateDraft(thin, { ...dish, dish_type }, index, mains).map((p) => p.code);
  expect(codesFor("main")).toContain("quantity_band");
  expect(codesFor("soup")).not.toContain("quantity_band");
});

test("a quantity band counts only the edible share of an ingredient", () => {
  const whole = { ...good, ingredients: [{ ...chicken, quantity: 2000 }] };
  const shares = { ...config, edible_share: { "chicken thigh": 0.4 } };
  expect(validateDraft(whole, dish, index, config).map((p) => p.code)).toContain("quantity_band");
  expect(validateDraft(whole, dish, index, shares)).toEqual([]);
});
