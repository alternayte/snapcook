import type { Db } from "@snapcook/db";
import {
  Allergen,
  type DeviceStep,
  DietFlag,
  Id,
  IngredientCategory,
  RecipeStatus,
  Unit,
} from "@snapcook/schema";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Auth } from "../auth/auth";
import { membership } from "../household/service";
import {
  approveIngredient,
  getRecipe,
  ingredientNames,
  listCommunity,
  listRecipes,
  listUnreviewed,
  mergeIngredient,
  setRemoved,
  setStatus,
} from "./queries";
import { styles } from "./styles";

type Markup = HtmlEscapedString | Promise<HtmlEscapedString>;

const page = (title: string, body: Markup) => html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${raw(styles)}</style>
  </head>
  <body><main>${body}</main></body>
</html>`;

const label = (value: string) => value.replaceAll("_", " ");

const SECTIONS = [
  ["recipes", "Official"],
  ["community", "Community"],
  ["ingredients", "New ingredients"],
] as const;

const sections = (current: (typeof SECTIONS)[number][0]) => html`<nav class="sections">
  ${SECTIONS.map(
    ([path, name]) =>
      html`<a href="/admin/${path}" ${current === path ? raw('aria-current="page"') : ""}>${name}</a>`,
  )}
</nav>`;

const when = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");

// What a person may set by hand. `draft` and `auto_reviewed` belong to the pipeline.
const HUMAN_STATUSES = ["human_reviewed", "test_cooked", "hidden"] as const;

const steps = (list: DeviceStep[]) => html`<ol class="steps">
  ${list.map(
    (step) => html`<li>
      <div>
        <div class="where">
          ${step.kind === "mc" ? "device" : step.kind}${step.lane === "side" ? " · alongside" : ""}${step.minutes === undefined ? "" : ` · ${step.minutes} min`}
        </div>
        ${step.text}
        ${
          step.mc
            ? html`<div class="settings">
              ${step.mc.temp_c} °C · speed ${step.mc.speed}${step.mc.reverse ? " · reverse" : ""} · ${step.mc.minutes} min${step.mc.accessory ? ` · ${label(step.mc.accessory)}` : ""}
            </div>`
            : ""
        }
      </div>
    </li>`,
  )}
</ol>`;

const loginPage = (failed: boolean) =>
  page(
    "Sign in",
    html`<h1>Sign in</h1>
      ${failed ? html`<p class="mark">That address and password do not match an owner account.</p>` : ""}
      <form class="login" method="post" action="/admin/login">
        <label>Email <input type="email" name="email" autocomplete="username" required /></label>
        <label>Password <input type="password" name="password" autocomplete="current-password" required /></label>
        <button type="submit">Sign in</button>
      </form>`,
  );

/** The recipe review pages. Only a member of a household on the owner plan may open them. */
export function createAdmin({
  db,
  auth,
  onRecipesChanged = () => {},
}: {
  db: Db;
  auth: Auth;
  /** Called after a community recipe is removed or put back, so kept copies read again. */
  onRecipesChanged?: () => void;
}) {
  const app = new Hono();
  app.use(csrf());

  const isOwner = async (headers: Headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session) return false;
    return (await membership(db, session.user.id))?.household.plan === "owner";
  };

  app.get("/login", (c) => c.html(loginPage(false)));
  app.post("/login", async (c) => {
    const form = await c.req.parseBody();
    const signedIn = await auth.api
      .signInEmail({
        body: { email: String(form.email ?? ""), password: String(form.password ?? "") },
        asResponse: true,
      })
      .catch(() => undefined);
    const cookies = signedIn?.ok ? signedIn.headers.getSetCookie() : [];
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    if (cookies.length === 0 || !(await isOwner(new Headers({ cookie })))) {
      return c.html(loginPage(true), 401);
    }
    for (const value of cookies) c.header("set-cookie", value, { append: true });
    return c.redirect("/admin/recipes", 303);
  });

  app.use(async (c, next) => {
    if (await isOwner(c.req.raw.headers)) return next();
    return c.req.method === "GET" ? c.redirect("/admin/login", 303) : c.text("forbidden", 403);
  });

  app.get("/recipes", async (c) => {
    const status = RecipeStatus.safeParse(c.req.query("status"));
    const filter = status.success ? status.data : undefined;
    const rows = await listRecipes(db, filter);
    return c.html(
      page(
        "Recipes",
        html`${sections("recipes")}<h1>Official recipes</h1>
          <p class="meta">${rows.length} shown</p>
          <nav class="filters">
            <a href="/admin/recipes" ${filter ? "" : raw('aria-current="page"')}>all</a>
            ${RecipeStatus.options.map(
              (s) =>
                html`<a href="/admin/recipes?status=${s}" ${filter === s ? raw('aria-current="page"') : ""}>${label(s)}</a>`,
            )}
          </nav>
          <table>
            <thead>
              <tr><th>Dish</th><th>Cuisine</th><th class="wide">Protein</th><th class="wide">Time</th><th class="wide">Device</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${rows.map(
                (r) => html`<tr>
                  <td><a href="/admin/recipes/${r.slug}">${r.title}</a></td>
                  <td>${label(r.cuisine)}</td>
                  <td class="wide">${label(r.primary_protein)}</td>
                  <td class="wide num">${r.time_total_min} min</td>
                  <td class="wide">${r.suitability ?? "—"}</td>
                  <td class="${r.status === "hidden" ? "mark" : r.status === "auto_reviewed" ? "" : "ok"}">${label(r.status)}</td>
                </tr>`,
              )}
            </tbody>
          </table>`,
      ),
    );
  });

  app.get("/recipes/:slug", async (c) => {
    const found = await getRecipe(db, c.req.param("slug"));
    if (!found) return c.notFound();
    const { recipe, version, lines, variant, allergens, image } = found;
    return c.html(
      page(
        version.title,
        html`<p class="meta"><a href="/admin/recipes">← Recipes</a></p>
          <h1>${version.title}</h1>
          ${image?.file ? html`<img class="dish" src="/api/v1/images/${image.file}" alt="" />` : ""}
          ${image && !image.file ? html`<p class="meta">No picture passed the check: ${image.findings.join("; ")}</p>` : ""}
          <p class="meta">
            ${label(version.cuisine)} · ${label(version.primary_protein)} · ${label(version.technique)} · ${version.time_total_min} min total,
            ${version.time_active_min} active · serves ${version.base_servings} · difficulty ${version.difficulty} · version ${version.version}
          </p>
          <p>${version.description}</p>
          <p class="meta">
            Status: <strong>${label(recipe.status)}</strong> · Allergens:
            ${allergens.length > 0 ? allergens.join(", ") : "none"} · Tags: ${version.tags.length > 0 ? version.tags.join(", ") : "none"}
          </p>
          <form class="promote" method="post" action="/admin/recipes/${recipe.slug}/status">
            ${HUMAN_STATUSES.filter((s) => s !== recipe.status).map(
              (s) =>
                html`<button name="status" value="${s}" class="${s === "hidden" ? "mark" : ""}">Mark ${label(s)}</button>`,
            )}
          </form>

          <h2>Ingredients</h2>
          <table>
            <tbody>
              ${lines.map(
                ({ line, name }) => html`<tr>
                  <td class="num">${line.quantity ?? ""} ${line.unit ?? ""}</td>
                  <td>${name}${line.prep ? html`<span class="meta"> — ${line.prep}</span>` : ""}</td>
                  <td class="meta">${line.role}</td>
                </tr>`,
              )}
            </tbody>
          </table>

          <h2>Method</h2>
          ${steps(version.steps)}

          <h2>Device variant${variant ? ` — ${variant.suitability}` : ""}</h2>
          ${variant ? html`<p class="meta">${variant.notes ?? ""}</p>${variant.steps.length > 0 ? steps(variant.steps) : ""}` : html`<p class="meta">None.</p>`}

          <h2>When it goes wrong</h2>
          <table>
            <tbody>
              ${version.failure_modes.map((f) => html`<tr><td>${f.symptom}</td><td>${f.fix}</td></tr>`)}
            </tbody>
          </table>

          <h2>Provenance</h2>
          <p class="meta">Written by ${version.provenance.writer_model ?? "unknown"}, reviewed by ${version.provenance.reviewer ?? "unknown"}.</p>
          <ul>
            ${version.provenance.references.map((r) => html`<li><a href="${r.url}" rel="noreferrer">${r.title}</a></li>`)}
          </ul>`,
      ),
    );
  });

  app.post("/recipes/:slug/status", async (c) => {
    const form = await c.req.parseBody();
    const status = RecipeStatus.extract([...HUMAN_STATUSES]).safeParse(form.status);
    if (!status.success) return c.text("unknown status", 400);
    const slug = c.req.param("slug");
    if (!(await setStatus(db, slug, status.data))) return c.notFound();
    return c.redirect(`/admin/recipes/${slug}`, 303);
  });

  app.get("/community", async (c) => {
    const rows = await listCommunity(db);
    return c.html(
      page(
        "Community",
        html`${sections("community")}<h1>Community recipes</h1>
          <p class="meta">${rows.length} shared. Removing a recipe takes it off every other household's list; its household keeps it and cannot share it again until you put it back.</p>
          <table>
            <thead><tr><th>Recipe</th><th>Household</th><th class="wide">Shared</th><th></th></tr></thead>
            <tbody>
              ${rows.map(
                (r) => html`<tr>
                  <td><a href="/admin/recipes/${r.slug}">${r.title}</a>${r.removed_at ? html`<div class="meta mark">removed ${when(r.removed_at)}</div>` : ""}</td>
                  <td>${r.household}</td>
                  <td class="wide num">${when(r.shared_at)}</td>
                  <td>
                    <form class="inline" method="post" action="/admin/community/${r.id}/${r.removed_at ? "restore" : "remove"}">
                      <button class="${r.removed_at ? "" : "mark"}">${r.removed_at ? "Put back" : "Remove"}</button>
                    </form>
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>`,
      ),
    );
  });

  app.post("/community/:id/:action{remove|restore}", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.notFound();
    if (!(await setRemoved(db, id.data, c.req.param("action") === "remove"))) return c.notFound();
    onRecipesChanged();
    return c.redirect("/admin/community", 303);
  });

  app.get("/ingredients", async (c) => {
    const rows = await listUnreviewed(db);
    const names = await ingredientNames(db);
    const boxes = <T extends string>(name: string, options: readonly T[], checked: T[]) =>
      options.map(
        (option) =>
          html`<label><input type="checkbox" name="${name}" value="${option}" ${checked.includes(option) ? "checked" : ""} /> ${label(option)}</label>`,
      );
    return c.html(
      page(
        "New ingredients",
        html`${sections("ingredients")}<h1>New ingredients</h1>
          <p class="meta">${rows.length} added by imports and not checked yet. They are in use already: fix the flags, then approve, or merge one into an ingredient the list had.</p>
          <datalist id="names">${names.map((n) => html`<option value="${n.name}"></option>`)}</datalist>
          ${rows.map(
            ({
              ingredient: i,
              recipe_id,
            }) => html`<form class="fix" method="post" action="/admin/ingredients/${i.id}">
              <h2>${i.name}</h2>
              <p class="meta">${i.aliases.length > 0 ? `Also called ${i.aliases.join(", ")}. ` : ""}${recipe_id ? "Added by a household's recipe import." : ""}</p>
              <div class="row">
                <label>Category <select name="category">${IngredientCategory.options.map((o) => html`<option ${o === i.category ? "selected" : ""}>${o}</option>`)}</select></label>
                <label>Unit <select name="default_unit">${Unit.options.map((o) => html`<option ${o === i.default_unit ? "selected" : ""}>${o}</option>`)}</select></label>
                <label>Grams per piece <input type="number" step="0.01" min="0" name="grams_per_unit" value="${i.grams_per_unit ?? ""}" /></label>
              </div>
              <fieldset><legend>Allergens</legend>${boxes("allergens", Allergen.options, i.allergens)}</fieldset>
              <fieldset><legend>Diet flags</legend>${boxes("contains", DietFlag.options, i.contains)}</fieldset>
              <div class="row">
                <button name="action" value="approve">Save and approve</button>
                <span class="meta">or merge into</span>
                <input list="names" name="into" placeholder="ingredient name" />
                <button class="mark" name="action" value="merge">Merge</button>
              </div>
            </form>`,
          )}`,
      ),
    );
  });

  app.post("/ingredients/:id", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.notFound();
    const form = await c.req.parseBody({ all: true });
    const list = (value: unknown) =>
      (Array.isArray(value) ? value : value ? [value] : []).map(String);
    if (form.action === "merge") {
      const name = String(form.into ?? "").trim();
      const target = (await ingredientNames(db)).find((n) => n.name === name);
      if (!target) return c.text(`No ingredient is called "${name}".`, 400);
      if (!(await mergeIngredient(db, id.data, target.id))) return c.notFound();
      onRecipesChanged();
      return c.redirect("/admin/ingredients", 303);
    }
    const category = IngredientCategory.safeParse(form.category);
    const unit = Unit.safeParse(form.default_unit);
    const allergens = list(form.allergens).filter(
      (a) => Allergen.safeParse(a).success,
    ) as Allergen[];
    const contains = list(form.contains).filter((d) => DietFlag.safeParse(d).success) as DietFlag[];
    const grams = Number(form.grams_per_unit);
    if (!category.success || !unit.success) return c.text("category and unit are needed", 400);
    if (unit.data === "piece" && !(grams > 0)) {
      return c.text("A counted ingredient needs its grams per piece.", 400);
    }
    const saved = await approveIngredient(db, id.data, {
      category: category.data,
      default_unit: unit.data,
      grams_per_unit: grams > 0 ? grams : null,
      allergens,
      contains,
    });
    if (!saved) return c.notFound();
    onRecipesChanged();
    return c.redirect("/admin/ingredients", 303);
  });

  return app;
}
