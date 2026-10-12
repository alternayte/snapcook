import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@snapcook/db";
import { createTestDb } from "@snapcook/db/testing";
import type { Llm } from "@snapcook/llm";
import { createIngredientMatcher } from "@snapcook/recognition";
import type { PantryItem, SnapProposal } from "@snapcook/schema";
import { and, eq } from "drizzle-orm";
import { createTestServer } from "../../testing";
import { deleteOldPhotos, failSnap, runDetection } from "./service";

const { db, pool } = await createTestDb();
const snapDir = await mkdtemp(join(tmpdir(), "snaps-"));
afterAll(async () => {
  await pool.end();
  await rm(snapDir, { recursive: true });
});

const [pepper, thigh] = await db
  .insert(schema.ingredients)
  .values([
    { name: "bell pepper", category: "vegetable", default_unit: "piece", grams_per_unit: 160 },
    { name: "chicken thigh", category: "poultry", default_unit: "g" },
  ])
  .returning();
if (!pepper || !thigh) throw new Error("no ingredients");

const item = (over: Record<string, unknown>) => ({
  quantity: null,
  unit: null,
  count_confidence: null,
  is_packaged: false,
  label_text: null,
  confidence: 0.9,
  ...over,
});
let seen = [
  item({
    name: "red peppers",
    canonical_guess: "bell peppers",
    quantity: 2,
    unit: "piece",
    count_confidence: 0.8,
  }),
  item({
    name: "pack of chicken",
    canonical_guess: "chicken thigh",
    is_packaged: true,
    label_text: "Chicken thighs 450 g",
  }),
  item({ name: "container", canonical_guess: "container", confidence: 0.4 }),
  item({ name: "purple thing", canonical_guess: "dragon fruit" }),
];
let modelWorks = true;
// The model reports the items above. Its embeddings match nothing, so unknown names stay free text.
const llm = {
  vision: async (
    _image: Uint8Array,
    _type: string,
    _schema: unknown,
    _hint: string,
    ctx: { onCost?: (usd: number) => void },
  ) => {
    if (!modelWorks) throw new Error("model down");
    ctx.onCost?.(0.002);
    return { items: seen };
  },
  embed: async (texts: string[]) => texts.map(() => Array.from({ length: 1024 }, () => 0)),
} as unknown as Llm;

const queued: string[] = [];
const { server, signUpWithHousehold } = createTestServer(db, {
  llm,
  snaps: { snapDir, enqueueDetect: async (id) => void queued.push(id) },
});
const deps = { db, llm, matcher: createIngredientMatcher(db), snapDir };

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const upload = (headers: Record<string, string>, bytes: Uint8Array, location = "fridge") => {
  const form = new FormData();
  form.set("photo", new File([bytes], "photo.jpg", { type: "image/jpeg" }));
  form.set("location", location);
  return server.request("/api/v1/snaps", { method: "POST", headers, body: form });
};
const json = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  server.request(`/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const used = async (householdId: string) =>
  (
    await db
      .select()
      .from(schema.usageCounters)
      .where(
        and(
          eq(schema.usageCounters.household_id, householdId),
          eq(schema.usageCounters.meter, "snaps"),
        ),
      )
  )[0]?.used;
const householdOf = async (headers: Record<string, string>) =>
  ((await (await json(headers, "GET", "/me")).json()) as { household: { id: string } }).household
    .id;

test("a photo is stored, detected, reviewed and committed into the pantry", async () => {
  const user = await signUpWithHousehold("snap@example.com");
  const household = await householdOf(user);
  // Peppers are already in the fridge, so the proposal must point at them.
  const stocked = (await (
    await json(user, "POST", "/pantry/items", { text: "1 bell pepper", location: "fridge" })
  ).json()) as { item: PantryItem };

  const res = await upload(user, JPEG);
  expect(res.status).toBe(201);
  const { snap_id } = (await res.json()) as { snap_id: string };
  expect(queued).toContain(snap_id);
  expect(await used(household)).toBe(1);
  expect(
    ((await (await json(user, "GET", `/snaps/${snap_id}`)).json()) as { status: string }).status,
  ).toBe("queued");

  await runDetection(deps, snap_id);
  const done = (await (await json(user, "GET", `/snaps/${snap_id}`)).json()) as {
    status: string;
    proposals: SnapProposal[];
  };
  expect(done.status).toBe("done");
  expect(
    done.proposals.map((p) => [p.name, p.ingredient_id, p.quantity, p.unit, p.existing_item_id]),
  ).toEqual([
    ["red peppers", pepper.id, 2, "piece", stocked.item.id],
    ["pack of chicken", thigh.id, 450, "g", null],
    ["container", null, null, null, null],
    ["purple thing", null, null, null, null],
  ]);
  const [row] = await db.select().from(schema.snaps).where(eq(schema.snaps.id, snap_id));
  expect(row?.cost_usd).toBe(0.002);

  const commit = await json(user, "POST", "/snaps/commit", {
    accepted: [
      {
        ingredient_id: pepper.id,
        display_name: "red peppers",
        quantity: 2,
        unit: "piece",
        location: "fridge",
        confidence: 0.9,
        merge: { existing_item_id: stocked.item.id, choice: "add" },
      },
      {
        ingredient_id: thigh.id,
        display_name: "pack of chicken",
        quantity: 450,
        unit: "g",
        location: "fridge",
        confidence: 0.9,
      },
    ],
  });
  expect(commit.status).toBe(200);
  const pantry = ((await (await json(user, "GET", "/pantry")).json()) as { items: PantryItem[] })
    .items;
  expect(pantry.map((i) => [i.display_name, i.quantity, i.source]).sort()).toEqual([
    ["bell pepper", 3, "manual"],
    ["pack of chicken", 450, "photo"],
  ]);
});

test("one household cannot read another's photo or merge into another's item", async () => {
  const a = await signUpWithHousehold("snap-a@example.com");
  const b = await signUpWithHousehold("snap-b@example.com");
  const { snap_id } = (await (await upload(a, JPEG)).json()) as { snap_id: string };
  expect((await json(b, "GET", `/snaps/${snap_id}`)).status).toBe(404);

  const mine = (await (
    await json(a, "POST", "/pantry/items", { text: "2 bell peppers", location: "counter" })
  ).json()) as { item: PantryItem };
  await json(b, "POST", "/snaps/commit", {
    accepted: [
      {
        ingredient_id: pepper.id,
        display_name: "peppers",
        quantity: 5,
        unit: "piece",
        location: "counter",
        confidence: 0.9,
        merge: { existing_item_id: mine.item.id, choice: "replace" },
      },
    ],
  });
  const [untouched] = await db
    .select()
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.id, mine.item.id));
  expect(untouched?.quantity).toBe(2);
  // B's item landed in B's own pantry instead.
  expect(
    ((await (await json(b, "GET", "/pantry")).json()) as { items: PantryItem[] }).items,
  ).toHaveLength(1);
});

test("a file that is not a photo is refused and costs nothing", async () => {
  const user = await signUpWithHousehold("snap-bad@example.com");
  expect((await upload(user, new TextEncoder().encode("not an image"))).status).toBe(400);
  expect((await upload(user, JPEG, "garage")).status).toBe(400);
  expect(await used(await householdOf(user))).toBeUndefined();
});

test("a photo of nothing edible is done with an empty list", async () => {
  const user = await signUpWithHousehold("snap-empty@example.com");
  const { snap_id } = (await (await upload(user, JPEG)).json()) as { snap_id: string };
  const before = seen;
  seen = [];
  await runDetection(deps, snap_id);
  seen = before;
  expect(await (await json(user, "GET", `/snaps/${snap_id}`)).json()).toMatchObject({
    status: "done",
    proposals: [],
  });
});

test("a detection that keeps failing marks the photo failed and gives the snap back", async () => {
  const user = await signUpWithHousehold("snap-fail@example.com");
  const household = await householdOf(user);
  const { snap_id } = (await (await upload(user, JPEG)).json()) as { snap_id: string };
  modelWorks = false;
  expect(runDetection(deps, snap_id)).rejects.toThrow("model down");
  modelWorks = true;
  await failSnap(db, snap_id);
  await failSnap(db, snap_id);
  expect(
    ((await (await json(user, "GET", `/snaps/${snap_id}`)).json()) as { status: string }).status,
  ).toBe("failed");
  expect(await used(household)).toBe(0);
});

test("a photo's file is deleted once it is old, and its row stays", async () => {
  const user = await signUpWithHousehold("snap-old@example.com");
  const { snap_id } = (await (await upload(user, JPEG)).json()) as { snap_id: string };
  const [row] = await db.select().from(schema.snaps).where(eq(schema.snaps.id, snap_id));
  const exists = () => Bun.file(join(snapDir, row?.storage_path ?? "")).exists();
  await deleteOldPhotos(db, snapDir);
  expect(await exists()).toBe(true);
  const removed = await deleteOldPhotos(db, snapDir, new Date(Date.now() + 24 * 60 * 60 * 1000));
  expect(removed).toBeGreaterThan(0);
  expect(await exists()).toBe(false);
  const [after] = await db.select().from(schema.snaps).where(eq(schema.snaps.id, snap_id));
  expect(after?.deleted_at).not.toBeNull();
});
