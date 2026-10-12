import { expect, test } from "bun:test";
import type {
  AdaptationControls,
  DeviceCapabilities,
  DeviceStep,
  HouseholdProfile,
  PantryItem,
} from "@snapcook/schema";
import {
  type AdaptedDraft,
  assemble,
  draftProblems,
  type IngredientFacts,
  inputHash,
  type KitchenFacts,
  plan,
  type RecipeFacts,
  sourceDraft,
} from "./adapt";

// Ids are fixed strings so a failed test reads clearly.
const ID = {
  chicken: "00000000-0000-7000-8000-000000000001",
  cream: "00000000-0000-7000-8000-000000000002",
  coconut: "00000000-0000-7000-8000-000000000003",
  wine: "00000000-0000-7000-8000-000000000004",
  pepper: "00000000-0000-7000-8000-000000000005",
  salt: "00000000-0000-7000-8000-000000000006",
  rice: "00000000-0000-7000-8000-000000000007",
};
const fact = (
  id: string,
  name: string,
  over: Partial<IngredientFacts> = {},
): [string, IngredientFacts] => [
  id,
  { id, name, allergens: [], contains: [], grams_per_unit: null, ml_per_unit: null, ...over },
];

const pan: DeviceStep = {
  index: 0,
  lane: "main",
  kind: "pan",
  text: "Brown the chicken.",
  minutes: 10,
};
const simmer: DeviceStep = { index: 1, lane: "main", kind: "pan", text: "Simmer.", minutes: 20 };
const machine: DeviceStep = {
  index: 1,
  lane: "main",
  kind: "mc",
  text: "Cook.",
  minutes: 20,
  mc: { temp_c: 100, minutes: 20, speed: 1, reverse: true },
};

const recipe: RecipeFacts = {
  recipe_version_id: "00000000-0000-7000-8000-0000000000aa",
  title: "Creamy chicken",
  base_servings: 4,
  steps: [pan, simmer],
  deviceSteps: [pan, machine],
  lines: [
    { ingredient_id: ID.chicken, quantity: 800, unit: "g", prep: null, role: "core" },
    { ingredient_id: ID.cream, quantity: 200, unit: "ml", prep: null, role: "core" },
    { ingredient_id: ID.wine, quantity: 100, unit: "ml", prep: null, role: "supporting" },
    { ingredient_id: ID.pepper, quantity: 2, unit: "piece", prep: "sliced", role: "supporting" },
    { ingredient_id: ID.salt, quantity: null, unit: null, prep: null, role: "staple" },
  ],
  ingredients: new Map([
    fact(ID.chicken, "chicken thigh", { contains: ["meat"] }),
    fact(ID.cream, "double cream", { allergens: ["milk"], contains: ["dairy"] }),
    fact(ID.coconut, "coconut milk"),
    fact(ID.wine, "white wine", { contains: ["alcohol"] }),
    fact(ID.pepper, "bell pepper", { grams_per_unit: 160 }),
    fact(ID.salt, "salt"),
    fact(ID.rice, "rice"),
  ]),
  substitutes: new Map([[ID.cream, [ID.coconut]]]),
};

const profile: HouseholdProfile = {
  household_id: "00000000-0000-7000-8000-0000000000bb",
  allergens: [],
  cannot_eat: [],
  cannot_eat_text: null,
  dislikes: [],
  diet_style: "none",
  toddler: false,
  devices: { mc_smart: true },
  default_servings: 2,
  default_time_min: 45,
  effort: "normal",
  staples: [ID.salt],
};
const item = (
  n: number,
  ingredient_id: string,
  quantity: number | null,
  unit: PantryItem["unit"],
): PantryItem => ({
  id: `00000000-0000-7000-8000-00000000010${n}`,
  household_id: profile.household_id,
  ingredient_id,
  display_name: "x",
  quantity,
  unit,
  location: "fridge",
  source: "manual",
  confidence: null,
  use_soon: false,
  expires_on: null,
  created_at: new Date(0),
  updated_at: new Date(0),
});
const pantry = [
  item(1, ID.chicken, 500, "g"),
  item(2, ID.coconut, 400, "ml"),
  item(3, ID.pepper, 300, "g"),
];
const kitchen = (over: Partial<HouseholdProfile> = {}, items = pantry): KitchenFacts => ({
  profile: { ...profile, ...over },
  pantry: items,
});
const controls: AdaptationControls = {
  servings: 2,
  device_profile_id: null,
  swaps: [],
  toddler_safe: false,
  lazier: false,
};
const milkAllergy = { allergens: [{ value: "milk" as const, added_by: profile.household_id }] };

test("the plan scales quantities and offers only stand-ins that are on hand and allowed", () => {
  const planned = plan(recipe, kitchen(milkAllergy), controls);
  expect(planned.lines.map((l) => [l.quantity, l.banned, l.standIns])).toEqual([
    [400, false, []],
    [100, true, [ID.coconut]],
    [50, false, []],
    [1, false, []],
    [null, false, []],
  ]);
  expect(planned.blocked).toBeNull();
  expect(planned.source).toEqual([pan, simmer]);
});

test("a banned defining ingredient with nothing to replace it blocks the adaptation", () => {
  const planned = plan(recipe, kitchen(milkAllergy, [pantry[0] as PantryItem]), controls);
  expect(planned.blocked).toEqual({ ingredient_id: ID.cream });
});

test("toddler-safe bans alcohol, and the device is used only when chosen", () => {
  const planned = plan(recipe, kitchen(), {
    ...controls,
    toddler_safe: true,
    device_profile_id: "mc_smart",
  });
  expect(planned.lines[2]?.banned).toBe(true);
  expect(planned.withDevice).toBe(true);
  expect(planned.source).toEqual([pan, machine]);
});

const device = {
  temp_c: { min: 0, max: 130 },
  speed: { min: 0, max: 10 },
  reverse_max_speed: 3,
  whisk_max_speed: 4,
  time_limits: [{ up_to_speed: 10, max_minutes: 99 }],
} as DeviceCapabilities;

test("a draft is refused for each way it can break the rules", () => {
  const planned = plan(recipe, kitchen(milkAllergy), controls);
  const good: AdaptedDraft = {
    ...sourceDraft(planned, null),
    ingredients: sourceDraft(planned, null).ingredients.map((i) =>
      i.ingredient_id === ID.cream
        ? { ...i, ingredient_id: ID.coconut, substituted_for: ID.cream }
        : i,
    ),
  };
  expect(draftProblems(good, planned, null)).toEqual([]);

  const bad = (change: (draft: AdaptedDraft) => AdaptedDraft) =>
    draftProblems(change(structuredClone(good)), planned, null);
  // The allergen comes back.
  expect(
    bad((d) => ({
      ...d,
      ingredients: [
        ...d.ingredients,
        { ingredient_id: ID.cream, quantity: 100, unit: "ml", substituted_for: null },
      ],
    })),
  ).toHaveLength(1);
  // A defining ingredient is dropped.
  expect(
    bad((d) => ({
      ...d,
      ingredients: d.ingredients.filter((i) => i.ingredient_id !== ID.chicken),
    })),
  ).toHaveLength(1);
  // A stand-in that was never offered.
  expect(
    bad((d) => ({
      ...d,
      ingredients: d.ingredients.map((i) =>
        i.ingredient_id === ID.coconut ? { ...i, ingredient_id: ID.rice } : i,
      ),
    })),
  ).toHaveLength(2);
  // A device step with no device in use.
  expect(bad((d) => ({ ...d, steps: [pan, machine] }))).toHaveLength(1);
  // Far more steps than the source.
  expect(
    bad((d) => ({ ...d, steps: Array.from({ length: 6 }, (_, index) => ({ ...pan, index })) })),
  ).toHaveLength(1);

  const withDevice = plan(recipe, kitchen(), { ...controls, device_profile_id: "mc_smart" });
  const hot = { ...machine, mc: { temp_c: 160, minutes: 20, speed: 1, reverse: true } };
  expect(
    draftProblems({ ...sourceDraft(withDevice, null), steps: [pan, hot] }, withDevice, device),
  ).toHaveLength(1);
});

test("assembly marks where each ingredient comes from and deducts no more than is held", () => {
  const planned = plan(recipe, kitchen(), controls);
  const draft: AdaptedDraft = {
    ...sourceDraft(planned, null),
    ingredients: sourceDraft(planned, null).ingredients.map((i) =>
      i.ingredient_id === ID.cream
        ? { ...i, ingredient_id: ID.coconut, substituted_for: ID.cream }
        : i,
    ),
  };
  const out = assemble(draft, recipe, kitchen(), controls);
  expect(out.ingredients.map((i) => [i.display, i.status, i.quantity])).toEqual([
    ["chicken thigh", "in_pantry", 400],
    ["coconut milk", "substituted", 100],
    ["white wine", "missing", 50],
    ["bell pepper", "in_pantry", 1],
    ["salt", "staple", null],
  ]);
  // One pepper is 160 g of the 300 g held. The chicken and the coconut milk are taken as they are.
  expect(out.deductions.map((d) => [d.quantity, d.unit])).toEqual([
    [400, "g"],
    [100, "ml"],
    [160, "g"],
  ]);
  const short = assemble(draft, recipe, kitchen({}, [item(1, ID.chicken, 250, "g")]), controls);
  expect(short.deductions).toEqual([
    { pantry_item_id: item(1, ID.chicken, 250, "g").id, quantity: 250, unit: "g" },
  ]);
});

test("the cache key ignores pantry changes that cannot affect this recipe", () => {
  const base = inputHash(recipe, kitchen(), controls);
  expect(inputHash(recipe, kitchen({}, [...pantry, item(4, ID.rice, 1000, "g")]), controls)).toBe(
    base,
  );
  // A few grams more chicken stays in the same bucket; a missing item does not.
  expect(
    inputHash(recipe, kitchen({}, [item(1, ID.chicken, 520, "g"), ...pantry.slice(1)]), controls),
  ).toBe(base);
  expect(inputHash(recipe, kitchen({}, pantry.slice(1)), controls)).not.toBe(base);
  expect(inputHash(recipe, kitchen(), { ...controls, servings: 4 })).not.toBe(base);
  expect(inputHash(recipe, kitchen(milkAllergy), controls)).not.toBe(base);
});
