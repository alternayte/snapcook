import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  drawPicture,
  type ImageConfig,
  indexIngredients,
  type PipelineConfig,
  profileText,
  slugify,
  validateDraft,
  validateVariant,
  writeVariant,
} from "@snapcook/authoring";
import { type Db, foldName, schema } from "@snapcook/db";
import type { CallContext, Llm } from "@snapcook/llm";
import { type IngredientMatcher, ingredientText } from "@snapcook/recognition";
import {
  Allergen,
  type DeviceVariantDraft,
  DietFlag,
  type Household,
  type ImportDraft,
  type ImportError,
  type ImportSummary,
  type ImportView,
  IngredientCategory,
  RecipeDraft,
} from "@snapcook/schema";
import { and, asc, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { release } from "../billing/usage";
import { amountOf, type Choices, ReadOutput, readHint } from "./read";

const {
  deviceProfiles,
  ingredientSubstitutes,
  ingredients,
  recipeDeviceVariants,
  recipeImages,
  recipeImports,
  recipeIngredients,
  recipes,
  recipeVersions,
} = schema;

// Uploaded images are removed this long after upload at the latest, as snap photos are.
const PHOTO_LIFETIME_MS = 23 * 60 * 60 * 1000;
// A problem the household's own quantities can cause. It is reported to the model once, but it
// does not stop a household from keeping its own recipe.
const ADVISORY = new Set(["quantity_band"]);

export type ImportDeps = {
  db: Db;
  llm: Llm;
  matcher: IngredientMatcher;
  /** Where uploaded images wait to be read. */
  photoDir: string;
  /** Where recipe pictures are written. With none, imported recipes get no picture. */
  imageDir?: string;
  /** The recipe writing prompts and limits. With none, imports are off. */
  pipeline?: PipelineConfig;
  /** The house style of recipe pictures. With none, imported recipes get no picture. */
  image?: ImageConfig;
  /** Called after a recipe was added or changed, so lists that keep a copy read again. */
  onRecipesChanged: () => void;
};

/** Thrown for an import that cannot go on; the code and problems are shown to the household. */
export class ImportStopped extends Error {
  constructor(
    readonly code: ImportError,
    readonly problems: string[] = [],
  ) {
    super(`import stopped: ${code}`);
  }
}

/** The values each classification field may take: those the official recipes use. */
export async function choices(db: Db): Promise<Choices> {
  const rows = await db
    .selectDistinct({
      cuisine: recipeVersions.cuisine,
      dish_type: recipeVersions.dish_type,
      primary_protein: recipeVersions.primary_protein,
      technique: recipeVersions.technique,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipe_id))
    .where(and(isNull(recipes.household_id), isNull(recipes.orphaned_at)));
  const of = (key: keyof Choices) => [...new Set(rows.map((row) => row[key]))].sort();
  return {
    cuisine: of("cuisine"),
    dish_type: of("dish_type"),
    primary_protein: of("primary_protein"),
    technique: of("technique"),
  };
}

/** Stores the uploaded images and the import's row. The caller counts the import first. */
export async function storeImport(
  db: Db,
  photoDir: string,
  input: { householdId: string; userId: string; files: { data: Uint8Array; ext: string }[] },
) {
  const id = Bun.randomUUIDv7();
  const photos: string[] = [];
  for (const [n, file] of input.files.entries()) {
    const path = join(input.householdId, "imports", `${id}-${n}.${file.ext}`);
    await mkdir(dirname(join(photoDir, path)), { recursive: true });
    await Bun.write(join(photoDir, path), file.data);
    photos.push(path);
  }
  await db.insert(recipeImports).values({
    id,
    household_id: input.householdId,
    user_id: input.userId,
    photos,
  });
  return id;
}

async function deletePhotos(photoDir: string, photos: string[]) {
  for (const path of photos) {
    await unlink(join(photoDir, path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/** Deletes the images of imports that are past their lifetime and still hold them. */
export async function deleteOldImportPhotos(db: Db, photoDir: string, now = new Date()) {
  const due = await db
    .select({ id: recipeImports.id, photos: recipeImports.photos })
    .from(recipeImports)
    .where(
      and(
        lt(recipeImports.created_at, new Date(now.getTime() - PHOTO_LIFETIME_MS)),
        ne(recipeImports.photos, []),
      ),
    );
  for (const row of due) {
    await deletePhotos(photoDir, row.photos);
    await db.update(recipeImports).set({ photos: [] }).where(eq(recipeImports.id, row.id));
  }
  return due.length;
}

/**
 * Ends an import without a recipe. A new import gives its allowance back; an edit never took one.
 */
export async function failImport(
  deps: Pick<ImportDeps, "db" | "photoDir">,
  id: string,
  stop: ImportStopped,
) {
  const [before] = await deps.db
    .select({ photos: recipeImports.photos })
    .from(recipeImports)
    .where(eq(recipeImports.id, id));
  const [row] = await deps.db
    .update(recipeImports)
    .set({
      status: "failed",
      error: stop.code,
      problems: stop.problems,
      photos: [],
      updated_at: new Date(),
    })
    .where(and(eq(recipeImports.id, id), inArray(recipeImports.status, ["reading", "saving"])))
    .returning();
  if (!row) return;
  await deletePhotos(deps.photoDir, before?.photos ?? []);
  if (!row.is_edit) await release(deps.db, row.household_id, "imports", row.created_at);
}

/** Matches each name to a canonical ingredient, by name, alias and singular, then by meaning. */
async function matchNames(
  deps: Pick<ImportDeps, "llm" | "matcher">,
  names: string[],
  ctx: CallContext,
) {
  const exact = await Promise.all(names.map((name) => deps.matcher.match(name)));
  const open = names.map((name, i) => ({ name, i })).filter(({ i }) => !exact[i]);
  const near = await deps.matcher.nearest(
    open.map(({ name }) => name),
    deps.llm,
    ctx,
  );
  const byMeaning = new Map(open.map(({ i }, n) => [i, near[n]]));
  return names.map((_, i) => exact[i] ?? byMeaning.get(i));
}

/**
 * Reads the stored images into a draft for the household to check. The images are deleted as
 * soon as they are read: only the draft is kept.
 */
export async function runRead(deps: ImportDeps, id: string) {
  const { db, llm } = deps;
  const [row] = await db.select().from(recipeImports).where(eq(recipeImports.id, id));
  if (!row || row.status !== "reading") return;
  const images = await Promise.all(
    row.photos.map(async (path) => ({
      data: await Bun.file(join(deps.photoDir, path)).bytes(),
      mediaType: path.endsWith(".png") ? ("image/png" as const) : ("image/jpeg" as const),
    })),
  );
  let cost = 0;
  const ctx = {
    endpoint: "imports.read",
    household_id: row.household_id,
    onCost: (usd: number) => {
      cost += usd;
    },
  };
  const allowed = await choices(db);
  const read = await llm.read(images, ReadOutput, readHint(allowed), { ...ctx, role: "adapt" });
  if (!read.is_recipe || read.ingredients.length === 0 || read.steps.length === 0) {
    throw new ImportStopped("not_a_recipe");
  }
  const matched = await matchNames(
    deps,
    read.ingredients.map((line) => line.generic),
    ctx,
  );
  const pick = (value: string, options: string[]) =>
    options.includes(value) ? value : (options[0] ?? value);
  const draft: ImportDraft = {
    title: read.title.trim() || "Untitled recipe",
    servings: Math.min(24, read.servings),
    time_total_min: read.time_total_min,
    time_active_min: Math.min(read.time_active_min, read.time_total_min),
    cuisine: pick(read.cuisine, allowed.cuisine),
    dish_type: pick(read.dish_type, allowed.dish_type),
    primary_protein: pick(read.primary_protein, allowed.primary_protein),
    technique: pick(read.technique, allowed.technique),
    ingredients: read.ingredients.map((line, i) => ({
      name: matched[i]?.name ?? line.generic.toLowerCase(),
      ingredient_id: matched[i]?.id ?? null,
      ...amountOf(line),
      prep: line.prep,
      role: line.role,
    })),
    steps: read.steps.map((step) => ({
      text: step.text,
      kind: step.kind,
      lane: step.lane,
      ...(step.minutes ? { minutes: step.minutes } : {}),
    })),
  };
  await db
    .update(recipeImports)
    .set({ status: "checking", draft, cost_usd: cost, photos: [], updated_at: new Date() })
    .where(eq(recipeImports.id, id));
  await deletePhotos(deps.photoDir, row.photos);
}

/** Starts an edit of the household's own recipe: an import that begins at the check. */
export async function startEdit(db: Db, householdId: string, userId: string, recipeId: string) {
  const [row] = await db
    .select({ version: recipeVersions })
    .from(recipes)
    .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
    .where(and(eq(recipes.id, recipeId), eq(recipes.household_id, householdId)));
  if (!row) return undefined;
  const lines = await db
    .select({ line: recipeIngredients, name: ingredients.name })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredient_id))
    .where(eq(recipeIngredients.recipe_version_id, row.version.id))
    .orderBy(asc(recipeIngredients.position));
  const { version } = row;
  const draft: ImportDraft = {
    title: version.title,
    servings: version.base_servings,
    time_total_min: version.time_total_min,
    time_active_min: version.time_active_min,
    cuisine: version.cuisine,
    dish_type: version.dish_type,
    primary_protein: version.primary_protein,
    technique: version.technique,
    ingredients: lines.map(({ line, name }) => ({
      name,
      ingredient_id: line.ingredient_id,
      quantity: line.quantity,
      unit: line.unit,
      prep: line.prep,
      role: line.role,
    })),
    steps: version.steps.map((step) => ({
      text: step.text,
      kind: step.kind === "mc" ? "prep" : step.kind,
      lane: step.lane,
      ...(step.minutes ? { minutes: step.minutes } : {}),
    })),
  };
  const [created] = await db
    .insert(recipeImports)
    .values({
      household_id: householdId,
      user_id: userId,
      recipe_id: recipeId,
      is_edit: true,
      status: "checking",
      draft,
    })
    .returning({ id: recipeImports.id });
  return created?.id;
}

/** An import as the app sees it, for its household only. */
/** The household's imports that have not become a recipe yet, newest first. */
export async function openImports(db: Db, householdId: string): Promise<ImportSummary[]> {
  const rows = await db
    .select({
      id: recipeImports.id,
      status: recipeImports.status,
      draft: recipeImports.draft,
      error: recipeImports.error,
      editing: recipeImports.is_edit,
      created_at: recipeImports.created_at,
    })
    .from(recipeImports)
    .where(and(eq(recipeImports.household_id, householdId), ne(recipeImports.status, "done")))
    .orderBy(desc(recipeImports.created_at));
  return rows.map(({ draft, ...row }) => ({ ...row, title: draft?.title ?? null }));
}

export async function importView(
  db: Db,
  householdId: string,
  id: string,
): Promise<ImportView | undefined> {
  const [row] = await db
    .select()
    .from(recipeImports)
    .where(and(eq(recipeImports.id, id), eq(recipeImports.household_id, householdId)));
  if (!row) return undefined;
  return {
    id: row.id,
    status: row.status,
    draft: row.draft,
    error: row.error,
    problems: row.problems,
    recipe_id: row.recipe_id,
    editing: row.is_edit,
    choices: await choices(db),
  };
}

const IngredientFacts = z.object({
  /** The plain name, singular, lower case. */
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  category: IngredientCategory,
  default_unit: z.enum(["g", "ml", "piece"]),
  grams_per_unit: z.number().positive().nullable(),
  ml_per_unit: z.number().positive().nullable(),
  allergens: z.array(Allergen),
  contains: z.array(DietFlag),
});

const INGREDIENT_SYSTEM = [
  "You describe one cooking ingredient for a kitchen app's ingredient list.",
  "name: the plain ingredient, singular, lower case, no brand. aliases: other common names, including the plural, or an empty list.",
  `category: one of ${IngredientCategory.options.join(", ")}.`,
  "default_unit: g for things that are weighed, ml for liquids, piece for things that are counted. grams_per_unit: the weight of one piece in grams when the unit is piece, else null. ml_per_unit: millilitres that one gram occupies for a liquid or powder if it is far from 1, else null.",
  `allergens: every one of ${Allergen.options.join(", ")} that the ingredient is, contains or is commonly made with. contains: every one of ${DietFlag.options.join(", ")} that applies; meat covers anything from a slaughtered land animal, such as stock, lard and gelatine.`,
  "People with allergies and diets rely on these flags. When you are not sure whether a flag applies, include it.",
].join("\n");

/** Adds an ingredient no list entry matched, marked unreviewed, and returns its id. */
async function addIngredient(deps: ImportDeps, importId: string, name: string, ctx: CallContext) {
  const facts = await deps.llm.structured(
    { system: INGREDIENT_SYSTEM, prompt: `Ingredient: ${name}` },
    IngredientFacts,
    { ...ctx, endpoint: "imports.ingredient", role: "adapt" },
  );
  const clean = foldName(facts.name) || foldName(name);
  // The model may give a name the list already has: that one is used.
  const known = await deps.matcher.match(clean);
  if (known) return { id: known.id, name: known.name, added: false };
  const aliases = [...new Set(facts.aliases.map(foldName))].filter((a) => a && a !== clean);
  const [vector] = await deps.llm.embed([ingredientText(clean, aliases)], ctx);
  // A counted ingredient needs a piece weight; without one it is weighed.
  const counted = facts.default_unit === "piece" && facts.grams_per_unit !== null;
  const [added] = await deps.db
    .insert(ingredients)
    .values({
      name: clean,
      aliases,
      category: facts.category,
      allergens: [...new Set(facts.allergens)],
      contains: [...new Set(facts.contains)],
      default_unit: counted ? "piece" : facts.default_unit === "piece" ? "g" : facts.default_unit,
      grams_per_unit: counted ? facts.grams_per_unit : null,
      ml_per_unit: facts.ml_per_unit,
      embedding: vector ?? null,
      reviewed: false,
      added_by_import_id: importId,
    })
    .onConflictDoNothing({ target: ingredients.name })
    .returning({ id: ingredients.id });
  if (added) return { id: added.id, name: clean, added: true };
  const [existing] = await deps.db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(eq(ingredients.name, clean));
  if (!existing) throw new Error(`ingredient "${clean}" was neither added nor found`);
  return { id: existing.id, name: clean, added: false };
}

/** The canonical ingredient names, grouped by category, for the writer. */
async function ingredientList(db: Db) {
  const rows = await db
    .select({ name: ingredients.name, category: ingredients.category })
    .from(ingredients)
    .orderBy(asc(ingredients.category), asc(ingredients.name));
  const groups = new Map<string, string[]>();
  for (const row of rows) groups.set(row.category, [...(groups.get(row.category) ?? []), row.name]);
  return [...groups].map(([category, names]) => `${category}: ${names.join(", ")}`).join("\n");
}

/**
 * Saves a checked import as a recipe of the household, or an edit as the recipe's next version.
 * A new import is rewritten, checked, fitted to the machine and drawn; an edit keeps its words
 * and picture, and is fitted to the machine again only when its ingredients or steps changed.
 */
export async function runSave(deps: ImportDeps, id: string) {
  const { db, llm } = deps;
  const pipeline = deps.pipeline;
  if (!pipeline) throw new Error("imports need PIPELINE_CONFIG");
  const [row] = await db.select().from(recipeImports).where(eq(recipeImports.id, id));
  if (!row || row.status !== "saving" || !row.draft) return;
  const draft = row.draft;
  let cost = row.cost_usd;
  const ctx = {
    endpoint: "imports.save",
    household_id: row.household_id,
    onCost: (usd: number) => {
      cost += usd;
    },
  };

  // The recipe being edited, when this is an edit.
  const [previous] =
    row.is_edit && row.recipe_id
      ? await db
          .select({ recipe: recipes, version: recipeVersions })
          .from(recipes)
          .innerJoin(recipeVersions, eq(recipeVersions.id, recipes.current_version_id))
          .where(and(eq(recipes.id, row.recipe_id), eq(recipes.household_id, row.household_id)))
      : [];
  if (row.is_edit && !previous) throw new ImportStopped("save_failed");
  // A new import that already made its recipe, before a crash, is not made twice.
  if (!row.is_edit && row.recipe_id) {
    await db.update(recipeImports).set({ status: "done" }).where(eq(recipeImports.id, id));
    return;
  }

  // Every line gets a canonical ingredient; a name no entry matches is added to the list.
  const matched = await matchNames(
    deps,
    draft.ingredients.map((line) => line.name),
    ctx,
  );
  let added = false;
  const canonical: { id: string; name: string }[] = [];
  for (const [i, line] of draft.ingredients.entries()) {
    const hit = matched[i];
    if (hit) {
      canonical.push(hit);
      continue;
    }
    const made = await addIngredient(deps, id, line.name, ctx);
    added ||= made.added;
    canonical.push(made);
  }
  if (added) deps.matcher.forget();
  const index = indexIngredients(await db.select().from(ingredients));
  const lines = draft.ingredients.map((line, i) => ({
    ...line,
    ingredient: canonical[i]?.name ?? line.name,
  }));
  const dish = { primary_protein: draft.primary_protein, dish_type: draft.dish_type };
  const check = (recipe: RecipeDraft) => {
    const found = validateDraft(recipe, dish, index, pipeline, draft.servings);
    // The rewrite must keep every ingredient the household checked.
    const kept = new Set(recipe.ingredients.map((l) => foldName(l.ingredient)));
    for (const line of lines) {
      if (!kept.has(foldName(line.ingredient))) {
        found.push({ code: "dropped", message: `Keep "${line.ingredient}": the recipe uses it.` });
      }
    }
    return found;
  };

  let recipe: RecipeDraft;
  if (previous) {
    recipe = {
      title: draft.title,
      description: previous.version.description,
      time_total_min: draft.time_total_min,
      time_active_min: draft.time_active_min,
      difficulty: previous.version.difficulty,
      ingredients: lines.map((line) => ({
        ingredient: line.ingredient,
        quantity: line.quantity,
        unit: line.unit,
        prep: line.prep,
        role: line.role,
        substitutes: [],
      })),
      steps: draft.steps.map((step, index) => ({ ...step, index })),
      tags: previous.version.tags,
      failure_modes: previous.version.failure_modes,
    };
  } else {
    const prompt = [
      `Dish: ${draft.title} (${draft.cuisine})`,
      `Classification: ${draft.dish_type}, ${draft.primary_protein}, ${draft.technique}`,
      `Write for ${draft.servings} servings.`,
      `Allowed tags: ${pipeline.tags.join(", ")}`,
      "",
      "This is a household's own recipe, which they have read and checked. Keep it the same dish: every ingredient, every quantity, and the order and meaning of the method. Write it in your own words, add the signs that tell the cook a step is done, and give the description, tags and failure modes. List substitutes only for core ingredients.",
      "",
      "The recipe as checked:",
      JSON.stringify({ ...draft, ingredients: lines }),
      "",
      "Canonical ingredients (use these names exactly):",
      await ingredientList(db),
    ].join("\n");
    const write = (extra: string[]) =>
      llm.structured(
        { system: pipeline.write.system, prompt: [prompt, ...extra].join("\n") },
        RecipeDraft,
        {
          ...ctx,
          endpoint: "imports.write",
          role: "adapt",
        },
      );
    recipe = await write([]);
    const first = check(recipe);
    if (first.length > 0) {
      recipe = await write([
        "",
        "Your previous draft:",
        JSON.stringify(recipe),
        "",
        "Fix every one of these findings and return the full corrected recipe:",
        ...first.map((p) => `- ${p.message}`),
      ]);
    }
  }
  const blocking = check(recipe).filter((p) => !ADVISORY.has(p.code));
  if (blocking.length > 0) {
    throw new ImportStopped(
      "checks_failed",
      blocking.map((p) => p.message),
    );
  }

  // The machine version, written again when the recipe is new or its content changed.
  const [oldVariant] = previous
    ? await db
        .select()
        .from(recipeDeviceVariants)
        .where(eq(recipeDeviceVariants.recipe_version_id, previous.version.id))
    : [];
  const oldLines = previous
    ? await db
        .select({
          ingredient_id: recipeIngredients.ingredient_id,
          quantity: recipeIngredients.quantity,
          unit: recipeIngredients.unit,
        })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipe_version_id, previous.version.id))
        .orderBy(asc(recipeIngredients.position))
    : [];
  const sameContent =
    previous !== undefined &&
    JSON.stringify(oldLines) ===
      JSON.stringify(
        lines.map((l, i) => ({
          ingredient_id: canonical[i]?.id,
          quantity: l.quantity,
          unit: l.unit,
        })),
      ) &&
    JSON.stringify(previous.version.steps.map((s) => s.text)) ===
      JSON.stringify(recipe.steps.map((s) => s.text));
  let variant: DeviceVariantDraft | undefined =
    oldVariant && sameContent
      ? {
          suitability: oldVariant.suitability,
          notes: oldVariant.notes ?? "",
          steps: oldVariant.steps,
        }
      : undefined;
  if (!variant) {
    const [profile] = await db
      .select()
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, "mc_smart"));
    if (profile) {
      const written = await writeVariant(
        llm,
        pipeline.device.system,
        { dish: `${draft.title} (${draft.cuisine})`, servings: draft.servings, recipe, profile },
        { ...ctx, endpoint: "imports.device", role: "adapt" },
      );
      variant =
        validateVariant(written, profile.capabilities).length === 0
          ? written
          : {
              suitability: "unsuitable",
              notes: "It did not fit within the machine's limits.",
              steps: [],
            };
    }
  }

  const technique = draft.technique;
  const [embedding] = await llm.embed(
    [profileText(recipe, { technique, cuisine: draft.cuisine })],
    ctx,
  );
  const idOf = (name: string) => index.get(foldName(name))?.id;

  const saved = await db.transaction(async (tx) => {
    let recipeId = previous?.recipe.id;
    if (!recipeId) {
      const newId = Bun.randomUUIDv7();
      const [created] = await tx
        .insert(recipes)
        .values({
          id: newId,
          slug: `${slugify(draft.title)}-${newId.slice(-8)}`,
          status: "auto_reviewed",
          household_id: row.household_id,
        })
        .returning({ id: recipes.id });
      recipeId = created?.id;
    }
    if (!recipeId) throw new Error("recipe insert returned nothing");
    const [version] = await tx
      .insert(recipeVersions)
      .values({
        recipe_id: recipeId,
        version: (previous?.version.version ?? 0) + 1,
        title: recipe.title,
        cuisine: draft.cuisine,
        dish_type: draft.dish_type,
        primary_protein: draft.primary_protein,
        technique,
        time_total_min: recipe.time_total_min,
        time_active_min: recipe.time_active_min,
        difficulty: recipe.difficulty,
        base_servings: draft.servings,
        description: recipe.description,
        steps: recipe.steps,
        tags: recipe.tags,
        failure_modes: recipe.failure_modes,
        provenance: {
          references: [],
          writer_model: previous
            ? (previous.version.provenance.writer_model ?? null)
            : "household import",
          reviewer: null,
          notes: previous ? "edited by the household" : "imported by the household",
        },
        embedding: embedding ?? null,
      })
      .returning({ id: recipeVersions.id });
    if (!version) throw new Error("version insert returned nothing");
    await tx.insert(recipeIngredients).values(
      recipe.ingredients.flatMap((line, position) => {
        const ingredientId = idOf(line.ingredient);
        return ingredientId
          ? [
              {
                recipe_version_id: version.id,
                ingredient_id: ingredientId,
                quantity: line.quantity,
                unit: line.unit,
                prep: line.prep,
                role: line.role,
                position,
              },
            ]
          : [];
      }),
    );
    const substitutes = recipe.ingredients.flatMap((line) =>
      line.substitutes.flatMap((name) => {
        const from = idOf(line.ingredient);
        const to = idOf(name);
        return from && to && from !== to
          ? [{ ingredient_id: from, substitute_id: to, context: "general" as const }]
          : [];
      }),
    );
    if (substitutes.length > 0) {
      await tx.insert(ingredientSubstitutes).values(substitutes).onConflictDoNothing();
    }
    if (variant) {
      await tx.insert(recipeDeviceVariants).values({
        recipe_version_id: version.id,
        device_profile_id: "mc_smart",
        steps: variant.steps,
        suitability: variant.suitability,
        notes: variant.notes,
      });
    }
    await tx
      .update(recipes)
      .set({ current_version_id: version.id })
      .where(eq(recipes.id, recipeId));
    await tx
      .update(recipeImports)
      .set({ recipe_id: recipeId, cost_usd: cost, updated_at: new Date() })
      .where(eq(recipeImports.id, id));
    return { recipeId, versionId: version.id };
  });

  // The picture: an edit keeps the one it had; a new recipe is drawn. A picture that fails is
  // no reason to lose the recipe.
  const [oldImage] = previous
    ? await db
        .select()
        .from(recipeImages)
        .where(eq(recipeImages.recipe_version_id, previous.version.id))
    : [];
  if (oldImage) {
    await db.insert(recipeImages).values({ ...oldImage, recipe_version_id: saved.versionId });
  } else if (!previous && deps.image && deps.imageDir) {
    try {
      const picture = await drawPicture(
        llm,
        deps.image,
        {
          title: recipe.title,
          description: recipe.description,
          dish_type: draft.dish_type,
          steps: recipe.steps,
          ingredients: recipe.ingredients.map((l) => ({
            name: l.ingredient,
            prep: l.prep,
            role: l.role,
          })),
        },
        { ...ctx, endpoint: "imports.image" },
      );
      const file = `${saved.versionId}.webp`;
      if (picture.webp) await Bun.write(join(deps.imageDir, file), picture.webp);
      await db.insert(recipeImages).values({
        recipe_version_id: saved.versionId,
        file: picture.webp ? file : null,
        model: "image",
        prompt: picture.prompt,
        findings: picture.faults,
      });
    } catch (error) {
      console.error(`import ${id}: no picture:`, error);
    }
  }

  await db
    .update(recipeImports)
    .set({ status: "done", cost_usd: cost, updated_at: new Date() })
    .where(eq(recipeImports.id, id));
  deps.onRecipesChanged();
}

/**
 * Sends a checked draft to be saved. A new import that failed before counts again, since its
 * failure gave the allowance back.
 */
export async function submit(
  db: Db,
  household: Pick<Household, "id">,
  id: string,
  draft: ImportDraft,
) {
  const [row] = await db
    .update(recipeImports)
    .set({ status: "saving", draft, error: null, problems: [], updated_at: new Date() })
    .where(
      and(
        eq(recipeImports.id, id),
        eq(recipeImports.household_id, household.id),
        inArray(recipeImports.status, ["checking", "failed"]),
      ),
    )
    .returning();
  return row;
}
