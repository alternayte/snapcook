import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineConfig } from "@snapcook/authoring";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { CallContext, Llm } from "@snapcook/llm";
import { createIngredientMatcher } from "@snapcook/recognition";
import type {
  BrowseResponse,
  DeviceCapabilities,
  DeviceVariantDraft,
  ImportView,
  RecipeDraft,
  RecipeView,
} from "@snapcook/schema";
import { eq } from "drizzle-orm";
import { createTestServer } from "../../testing";
import { setRemoved } from "../admin/queries";
import type { ReadOutput } from "./read";
import { failImport, type ImportDeps, ImportStopped, runRead, runSave } from "./service";

const { db, pool } = await createTestDb();
afterAll(() => pool.end());

const [lentils] = await db
  .insert(schema.ingredients)
  .values([
    { name: "red lentils", category: "pulse", default_unit: "g" },
    { name: "salt", category: "spice", default_unit: "g", is_staple_default: true },
  ])
  .returning();
if (!lentils) throw new Error("no ingredients");
await db.insert(schema.deviceProfiles).values({
  id: "mc_smart",
  name: "Test machine",
  capabilities: {
    temp_c: { min: 0, max: 130 },
    speed: { min: 0, max: 10 },
    reverse_max_speed: 3,
    whisk_max_speed: 4,
    time_limits: [{ up_to_speed: 10, max_minutes: 99 }],
    bowl_max_fill_ml: 2000,
    high_speed_max_liquid_ml: 1000,
    scale: { max_g: 5000, step_g: 1 },
    accessories: [],
    programs: {},
  } satisfies DeviceCapabilities,
});
// One official recipe gives the classification values the reader may choose from.
const [official] = await db
  .insert(schema.recipes)
  .values({ slug: "official-dal", status: "auto_reviewed" })
  .returning();
if (!official) throw new Error("no recipe");
const [officialVersion] = await db
  .insert(schema.recipeVersions)
  .values({
    recipe_id: official.id,
    version: 1,
    title: "Dal",
    cuisine: "indian",
    dish_type: "main",
    primary_protein: "pulses",
    technique: "simmer",
    time_total_min: 40,
    time_active_min: 10,
    difficulty: 1,
    base_servings: 4,
    description: "Lentils.",
    steps: [{ index: 0, lane: "main", kind: "pan", text: "Simmer.", minutes: 40 }],
    provenance: { references: [], writer_model: null, reviewer: null, notes: null },
  })
  .returning();
if (!officialVersion) throw new Error("no version");
await db
  .update(schema.recipes)
  .set({ current_version_id: officialVersion.id })
  .where(eq(schema.recipes.id, official.id));

const read: ReadOutput = {
  is_recipe: true,
  title: "Grandma's dal",
  servings: 4,
  time_total_min: 45,
  time_active_min: 15,
  cuisine: "indian",
  dish_type: "main",
  primary_protein: "pulses",
  technique: "simmer",
  ingredients: [
    {
      text: "250g red lentils",
      generic: "red lentils",
      quantity: 250,
      unit: "g",
      prep: "rinsed",
      role: "core",
    },
    {
      text: "2 tbsp Mae Ploy curry paste",
      generic: "red curry paste",
      quantity: 2,
      unit: "tablespoons",
      prep: null,
      role: "supporting",
    },
  ],
  steps: [
    { text: "Fry the paste.", kind: "pan", lane: "main", minutes: 5 },
    { text: "Add the lentils and simmer.", kind: "pan", lane: "main", minutes: 40 },
  ],
};

const rewrite = (lentilGrams: number): RecipeDraft => ({
  title: "Grandma's dal",
  description: "A family dal. Warm and simple.",
  time_total_min: 45,
  time_active_min: 15,
  difficulty: 1,
  ingredients: [
    {
      ingredient: "red lentils",
      quantity: lentilGrams,
      unit: "g",
      prep: "rinsed",
      role: "core",
      substitutes: [],
    },
    {
      ingredient: "red curry paste",
      quantity: 2,
      unit: "tbsp",
      prep: null,
      role: "supporting",
      substitutes: [],
    },
  ],
  steps: [
    { index: 0, lane: "main", kind: "pan", text: "Fry the paste until fragrant.", minutes: 5 },
    { index: 1, lane: "main", kind: "pan", text: "Simmer the lentils until soft.", minutes: 40 },
  ],
  tags: [],
  failure_modes: [],
});

const calls: string[] = [];
const llm = {
  read: async () => read,
  structured: async (_prompt: unknown, _schema: unknown, ctx: CallContext) => {
    calls.push(ctx.endpoint);
    if (ctx.endpoint === "imports.ingredient") {
      return {
        name: "red curry paste",
        aliases: ["curry paste"],
        category: "sauce",
        default_unit: "g",
        grams_per_unit: null,
        ml_per_unit: null,
        allergens: ["crustaceans"],
        contains: ["shellfish"],
      };
    }
    if (ctx.endpoint === "imports.write") return rewrite(250);
    if (ctx.endpoint === "imports.device") {
      return {
        suitability: "unsuitable",
        notes: "Too wet.",
        steps: [],
      } satisfies DeviceVariantDraft;
    }
    throw new Error(`unexpected call ${ctx.endpoint}`);
  },
  embed: async (texts: string[]) => texts.map(() => new Array(1024).fill(0.01)),
} as unknown as Llm;

const pipeline: PipelineConfig = {
  tags: ["one-pot"],
  bands: [],
  edible_share: {},
  research: { system: "r" },
  write: { system: "w" },
  device: { system: "d" },
  review: { system: "v" },
};
const photoDir = await mkdtemp(join(tmpdir(), "imports-"));
const queued: string[] = [];
let changed = 0;
const deps: ImportDeps = {
  db,
  llm,
  matcher: createIngredientMatcher(db),
  photoDir,
  pipeline,
  onRecipesChanged: () => {
    changed += 1;
  },
};
const { server, signUpWithHousehold } = createTestServer(db, {
  imports: {
    photoDir,
    enabled: true,
    enqueueRead: async (id) => {
      queued.push(`read:${id}`);
    },
    enqueueSave: async (id) => {
      queued.push(`save:${id}`);
    },
  },
});
const owner = await signUpWithHousehold("cook@example.com");
const guest = await signUpWithHousehold("guest@example.com");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
async function upload(headers: Record<string, string>) {
  const form = new FormData();
  form.append("photo", new File([JPEG], "a.jpg", { type: "image/jpeg" }));
  form.append("photo", new File([JPEG], "b.jpg", { type: "image/jpeg" }));
  return server.request("/api/v1/imports", { method: "POST", headers, body: form });
}
const get = async <T>(headers: Record<string, string>, path: string) => {
  const res = await server.request(`/api/v1${path}`, { headers });
  return { status: res.status, body: (res.status === 200 ? await res.json() : null) as T };
};
const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let recipeId = "";

test("photos become a draft to check, and the images are gone once read", async () => {
  const res = await upload(owner);
  expect(res.status).toBe(201);
  const { import_id } = (await res.json()) as { import_id: string };
  expect(queued).toContain(`read:${import_id}`);

  await runRead(deps, import_id);
  const { body: view } = await get<ImportView>(owner, `/imports/${import_id}`);
  expect(view.status).toBe("checking");
  expect(view.draft?.ingredients.map((l) => [l.name, l.ingredient_id])).toEqual([
    ["red lentils", lentils.id],
    ["red curry paste", null],
  ]);
  // A unit written out in words becomes the app's own.
  expect(view.draft?.ingredients[1]).toMatchObject({ quantity: 2, unit: "tbsp" });
  expect(await readdir(join(photoDir, await householdId(owner), "imports"))).toEqual([]);
  // Another household cannot see it.
  expect((await get(guest, `/imports/${import_id}`)).status).toBe(404);

  // The checked draft is saved: a new ingredient is added, unreviewed, with its flags.
  const draft = view.draft;
  if (!draft) throw new Error("no draft");
  expect((await send(owner, "PUT", `/imports/${import_id}`, { draft })).status).toBe(202);
  expect(queued).toContain(`save:${import_id}`);
  await runSave(deps, import_id);
  const { body: done } = await get<ImportView>(owner, `/imports/${import_id}`);
  expect(done.status).toBe("done");
  recipeId = done.recipe_id ?? "";
  expect(changed).toBe(1);

  const [paste] = await db
    .select()
    .from(schema.ingredients)
    .where(eq(schema.ingredients.name, "red curry paste"));
  expect(paste).toMatchObject({
    reviewed: false,
    allergens: ["crustaceans"],
    added_by_import_id: import_id,
  });

  const { body: recipe } = await get<RecipeView>(owner, `/recipes/${recipeId}`);
  expect(recipe).toMatchObject({ title: "Grandma's dal", source: "household", sharing: "private" });
});

async function householdId(headers: Record<string, string>) {
  const { body } = await get<{ household: { id: string } }>(headers, "/me");
  return body.household.id;
}

test("a household recipe is private until shared, and an admin removal sticks", async () => {
  expect((await get(guest, `/recipes/${recipeId}`)).status).toBe(404);
  const browse = async () =>
    (await get<BrowseResponse>(guest, "/recipes?fits=false")).body.cards.map((c) => c.recipe_id);
  expect(await browse()).not.toContain(recipeId);

  expect((await send(owner, "POST", `/recipes/${recipeId}/share`)).status).toBe(204);
  const { body: seen } = await get<RecipeView>(guest, `/recipes/${recipeId}`);
  expect(seen).toMatchObject({ source: "community", sharing: null });
  expect(await browse()).toContain(recipeId);
  // Only the owning household can share or unshare it.
  expect((await send(guest, "DELETE", `/recipes/${recipeId}/share`)).status).toBe(404);

  await setRemoved(db, recipeId, true);
  // The admin's removal reaches other households at once, since recipes are read per request.
  expect((await get(guest, `/recipes/${recipeId}`)).status).toBe(404);
  const { body: kept } = await get<RecipeView>(owner, `/recipes/${recipeId}`);
  expect(kept.sharing).toBe("removed");
  expect((await send(owner, "POST", `/recipes/${recipeId}/share`)).status).toBe(403);
});

test("an edit makes the next version and keeps the household's words", async () => {
  const res = await send(owner, "POST", `/recipes/${recipeId}/edit`);
  expect(res.status).toBe(201);
  const { import_id } = (await res.json()) as { import_id: string };
  const { body: view } = await get<ImportView>(owner, `/imports/${import_id}`);
  expect(view).toMatchObject({ status: "checking", editing: true });
  const draft = view.draft;
  if (!draft) throw new Error("no draft");
  const changedDraft = {
    ...draft,
    ingredients: draft.ingredients.map((l, i) => (i === 0 ? { ...l, quantity: 300 } : l)),
  };
  calls.length = 0;
  expect((await send(owner, "PUT", `/imports/${import_id}`, { draft: changedDraft })).status).toBe(
    202,
  );
  await runSave(deps, import_id);

  // No rewrite for an edit; the machine version is written again because an amount changed.
  expect(calls).toEqual(["imports.device"]);
  const [row] = await db
    .select({ version: schema.recipeVersions.version, title: schema.recipeVersions.title })
    .from(schema.recipes)
    .innerJoin(
      schema.recipeVersions,
      eq(schema.recipeVersions.id, schema.recipes.current_version_id),
    )
    .where(eq(schema.recipes.id, recipeId));
  expect(row).toEqual({ version: 2, title: "Grandma's dal" });
});

test("imports have a monthly allowance, and a failed import gives its use back", async () => {
  // The free plan allows three; one was used above.
  expect((await upload(owner)).status).toBe(201);
  const third = await upload(owner);
  expect(third.status).toBe(201);
  expect((await upload(owner)).status).toBe(429);

  const { import_id } = (await third.json()) as { import_id: string };
  await failImport(deps, import_id, new ImportStopped("not_a_recipe"));
  const { body } = await get<ImportView>(owner, `/imports/${import_id}`);
  expect(body).toMatchObject({ status: "failed", error: "not_a_recipe" });
  expect((await upload(owner)).status).toBe(201);
});
