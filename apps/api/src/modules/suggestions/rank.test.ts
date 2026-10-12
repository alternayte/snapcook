import { expect, test } from "bun:test";
import type { DietFlag, SuggestRequest } from "@snapcook/schema";
import { type Corpus, type CorpusRecipe, type Kitchen, pickVaried, rank } from "./rank";

const ingredient = (
  id: string,
  over: { allergens?: string[]; contains?: DietFlag[]; grams?: number } = {},
) =>
  [
    id,
    {
      id,
      name: id,
      allergens: (over.allergens ?? []) as never[],
      contains: over.contains ?? [],
      grams_per_unit: over.grams ?? null,
      ml_per_unit: null,
    },
  ] as const;

const ingredients = new Map([
  ingredient("chicken", { contains: ["meat"] }),
  ingredient("rice"),
  ingredient("pepper", { grams: 150 }),
  ingredient("cream", { allergens: ["milk"], contains: ["dairy"] }),
  ingredient("coconut milk"),
  ingredient("mushroom"),
  ingredient("wine", { contains: ["alcohol"] }),
  ingredient("stock"),
  ingredient("salt"),
  ingredient("basil"),
]);

const recipe = (
  id: string,
  over: Omit<Partial<CorpusRecipe>, "lines"> & {
    lines: [string, CorpusRecipe["lines"][number]["role"], number?][];
  },
): CorpusRecipe => ({
  recipe_version_id: id,
  primary_protein: "chicken_thigh",
  technique: "braise",
  cuisine: "french",
  time_total_min: 40,
  time_active_min: 15,
  difficulty: 1,
  base_servings: 4,
  has_device_variant: false,
  embedding: null,
  ...over,
  lines: over.lines.map(([ingredient_id, role, quantity]) => ({
    ingredient_id,
    role,
    quantity: quantity ?? null,
    unit: quantity === undefined ? null : "g",
  })),
});

const request: SuggestRequest = {
  time_budget_min: 60,
  servings: 4,
  effort: "normal",
  use_up: [],
  craving: null,
  mc_only: false,
};
const kitchen = (
  pantry: string[],
  profile: Partial<Kitchen["profile"]> = {},
  over: Partial<Kitchen> = {},
): Kitchen => ({
  pantry: pantry.map((ingredient_id) => ({
    ingredient_id,
    quantity: null,
    unit: null,
    use_soon: false,
  })),
  profile: {
    allergens: [],
    cannot_eat: [],
    dislikes: [],
    diet_style: "none",
    staples: ["salt"],
    ...profile,
  },
  pantryVector: null,
  cravingVector: null,
  ...over,
});
const corpus = (recipes: CorpusRecipe[], substitutes: Record<string, string[]> = {}): Corpus => ({
  recipes,
  ingredients,
  substitutes: new Map(Object.entries(substitutes)),
});
const ids = (c: Corpus, k: Kitchen, r = request) =>
  rank(c, k, r).ranked.map((s) => s.recipe_version_id);

const creamy = recipe("creamy", {
  lines: [
    ["chicken", "core"],
    ["cream", "core"],
    ["mushroom", "supporting"],
    ["salt", "staple"],
    ["basil", "optional"],
  ],
});

test("a dish qualifies only when every core ingredient is on hand or has a stand-in that is", () => {
  const c = corpus([creamy], { cream: ["coconut milk"] });
  expect(ids(c, kitchen(["chicken"]))).toEqual([]);
  expect(ids(c, kitchen(["chicken", "cream"]))).toEqual(["creamy"]);
  const swapped = rank(c, kitchen(["chicken", "coconut milk"]), request).ranked[0];
  expect(swapped?.substituted).toEqual([{ ingredient_id: "cream", substitute_id: "coconut milk" }]);
  expect(swapped?.missing).toEqual(["mushroom"]);
  // The staple is assumed and the optional herb is ignored.
  expect(swapped?.have).toEqual(["chicken"]);
});

test("a dish one or two core ingredients short is a near miss, not a result", () => {
  const { ranked, near } = rank(corpus([creamy]), kitchen(["chicken"]), request);
  expect(ranked).toEqual([]);
  expect(near).toEqual([{ recipe_version_id: "creamy", missing_core: ["cream"] }]);
});

test("an assumed staple covers an ingredient and is not listed as something the household has", () => {
  const salty = recipe("salty", {
    lines: [
      ["salt", "core"],
      ["chicken", "core"],
    ],
  });
  const [result] = rank(corpus([salty]), kitchen(["chicken"]), request).ranked;
  expect(result?.have).toEqual(["chicken"]);
});

test("a dish with none of its core ingredients on hand is not a near miss", () => {
  const plain = recipe("plain", { lines: [["chicken", "core"]] });
  expect(rank(corpus([plain]), kitchen(["rice"]), request).near).toEqual([]);
});

test("an allergen rules a dish out unless a safe stand-in is on hand", () => {
  const allergic = { allergens: [{ value: "milk" as const, added_by: "u" }] };
  const c = corpus([creamy], { cream: ["coconut milk"] });
  expect(ids(c, kitchen(["chicken", "cream"], allergic))).toEqual([]);
  expect(ids(c, kitchen(["chicken", "cream", "coconut milk"], allergic))).toEqual(["creamy"]);
});

test("cannot-eat, diet style, time budget and device-only are hard limits", () => {
  const stew = recipe("stew", {
    lines: [
      ["chicken", "core"],
      ["wine", "supporting"],
    ],
  });
  const pilaf = recipe("pilaf", {
    time_total_min: 90,
    has_device_variant: true,
    lines: [["rice", "core"]],
  });
  const c = corpus([stew, pilaf]);
  const all = ["chicken", "rice", "wine"];
  expect(ids(c, kitchen(all), { ...request, time_budget_min: 120 })).toEqual(["pilaf", "stew"]);
  expect(ids(c, kitchen(all))).toEqual(["stew"]);
  expect(ids(c, kitchen(all), { ...request, time_budget_min: 120, mc_only: true })).toEqual([
    "pilaf",
  ]);
  expect(ids(c, kitchen(all, { cannot_eat: ["chicken"] }))).toEqual([]);
  expect(
    ids(c, kitchen(all, { diet_style: "vegetarian" }), { ...request, time_budget_min: 120 }),
  ).toEqual(["pilaf"]);
  // Wine is only a supporting ingredient, and it still rules the dish out for a halal household.
  expect(ids(c, kitchen(all, { diet_style: "halal" }))).toEqual([]);
  expect(ids(corpus([creamy]), kitchen(["chicken", "cream"], { diet_style: "kosher" }))).toEqual(
    [],
  );
});

test("more supporting ingredients, use-soon items and fewer dislikes rank a dish higher", () => {
  const full = recipe("full", {
    lines: [
      ["chicken", "core"],
      ["pepper", "supporting"],
      ["mushroom", "supporting"],
      ["rice", "supporting"],
    ],
  });
  const half = recipe("half", {
    cuisine: "thai",
    technique: "stir_fry",
    lines: [
      ["chicken", "core"],
      ["pepper", "supporting"],
      ["basil", "supporting"],
      ["rice", "supporting"],
    ],
  });
  const c = corpus([half, full]);
  const base = ["chicken", "pepper", "mushroom", "rice"];
  expect(ids(c, kitchen(base))).toEqual(["full", "half"]);
  expect(ids(c, kitchen(base, { dislikes: ["mushroom"] }))).toEqual(["half", "full"]);

  const rice = recipe("rice", { lines: [["rice", "core"]] });
  const plain = recipe("plain", { lines: [["chicken", "core"]] });
  const k = kitchen(["chicken", "rice"]);
  k.pantry[1] = { ingredient_id: "rice", quantity: null, unit: null, use_soon: true };
  const result = rank(corpus([plain, rice]), k, request).ranked;
  expect(result.map((r) => r.recipe_version_id)).toEqual(["rice", "plain"]);
  expect(result[0]?.uses_use_soon).toEqual(["rice"]);
});

test("a pantry item far larger than the dish needs counts as one to use up", () => {
  const peppers = recipe("peppers", { lines: [["pepper", "core", 300]] });
  const plain = recipe("plain", { lines: [["chicken", "core"]] });
  const k = kitchen(["chicken", "pepper"]);
  k.pantry[1] = { ingredient_id: "pepper", quantity: 6, unit: "piece", use_soon: false };
  expect(rank(corpus([plain, peppers]), k, request).ranked[0]?.uses_use_soon).toEqual(["pepper"]);
});

test("a page never holds two dishes that share two of protein, technique and cuisine, and pages do not repeat", () => {
  const facts = new Map([
    ["a", { primary_protein: "chicken", technique: "braise", cuisine: "french" }],
    ["b", { primary_protein: "chicken", technique: "braise", cuisine: "thai" }],
    ["c", { primary_protein: "beef", technique: "roast", cuisine: "french" }],
    ["d", { primary_protein: "pulse", technique: "soup", cuisine: "indian" }],
  ]);
  const ranked = ["a", "b", "c", "d"].map((recipe_version_id) => ({ recipe_version_id }));
  const first = pickVaried(ranked, facts, new Set(), 2);
  expect(first.picked.map((p) => p.recipe_version_id)).toEqual(["a", "c"]);
  expect(first.more).toBe(true);
  const second = pickVaried(ranked, facts, new Set(["a", "c"]), 2);
  expect(second.picked.map((p) => p.recipe_version_id)).toEqual(["b", "d"]);
  expect(second.more).toBe(false);
});

test("ranking 1,500 dishes against a full pantry stays fast", () => {
  const names = [...ingredients.keys()];
  const many = Array.from({ length: 1500 }, (_, i) =>
    recipe(`r${i}`, {
      embedding: Array.from({ length: 1024 }, (_, j) => ((i + j) % 7) / 7),
      lines: names.map((name, j) => [name, j % 3 === 0 ? "core" : "supporting", 100]),
    }),
  );
  const k = kitchen(
    names,
    {},
    { pantryVector: Array.from({ length: 1024 }, (_, j) => (j % 5) / 5) },
  );
  const started = performance.now();
  const { ranked } = rank(corpus(many), k, request);
  expect(ranked).toHaveLength(1500);
  expect(performance.now() - started).toBeLessThan(300);
});
