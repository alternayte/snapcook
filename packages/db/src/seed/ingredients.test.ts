import { afterAll, expect, test } from "bun:test";
import { schema } from "../client";
import { createTestDb } from "../testing";
import { parseIngredientSeed, SeedError, upsertIngredients } from "./ingredients";

const HEADER =
  "name\taliases\tcategory\tallergens\tcontains\tdefault_unit\tgrams_per_unit\tml_per_unit\tis_staple_default";
const tsv = (...rows: string[]) => [HEADER, ...rows].join("\n");

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

test("loading the same list twice updates rows in place", async () => {
  const first = parseIngredientSeed(
    tsv(
      "Bell Pepper\tcapsicum|sweet pepper\tvegetable\t\t\tpiece\t150\t\tfalse",
      "milk\t\tdairy\tmilk\tdairy\tml\t\t1.03\tfalse",
    ),
  );
  await upsertIngredients(db, first);
  const second = parseIngredientSeed(
    tsv(
      "bell pepper\tcapsicum\tvegetable\t\t\tpiece\t160\t\tfalse",
      "milk\t\tdairy\tmilk\tdairy\tml\t\t1.03\ttrue",
    ),
  );
  await upsertIngredients(db, second);

  const rows = await db.select().from(schema.ingredients).orderBy(schema.ingredients.name);
  expect(
    rows.map((r) => [r.name, r.aliases, r.grams_per_unit, r.allergens, r.is_staple_default]),
  ).toEqual([
    ["bell pepper", ["capsicum"], 160, [], false],
    ["milk", [], null, ["milk"], true],
  ]);
});

test("every bad row is reported in one error", () => {
  const bad = tsv(
    "carrot\t\tvegetable\t\t\tpiece\t\t\tfalse",
    "courgette\tzucchini\tvegetable\t\t\tpiece\t200\t\tfalse",
    "zucchini\t\tvegetable\t\t\tpiece\t200\t\tfalse",
    "tofu\t\tpulse\tsoya\t\tg\t\t\tfalse",
  );
  let error: unknown;
  try {
    parseIngredientSeed(bad);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(SeedError);
  const problems = (error as SeedError).problems.join("\n");
  expect(problems).toContain("line 2 (carrot): a counted ingredient needs grams_per_unit");
  expect(problems).toContain(
    'line 4 (zucchini): "zucchini" is already a name or alias of "courgette"',
  );
  expect(problems).toContain("line 5 (tofu): allergens.0");
});
