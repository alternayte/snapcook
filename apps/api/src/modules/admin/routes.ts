import type { Db } from "@snapcook/db";
import { type DeviceStep, RecipeStatus } from "@snapcook/schema";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { csrf } from "hono/csrf";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { getRecipe, listRecipes, setStatus } from "./queries";
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

/** The recipe review pages. One shared password until accounts exist. */
export function createAdmin({ db, password }: { db: Db; password: string }) {
  const app = new Hono();
  app.use(csrf());
  app.use(basicAuth({ username: "admin", password }));

  app.get("/recipes", async (c) => {
    const status = RecipeStatus.safeParse(c.req.query("status"));
    const filter = status.success ? status.data : undefined;
    const rows = await listRecipes(db, filter);
    return c.html(
      page(
        "Recipes",
        html`<h1>Recipes</h1>
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
    const { recipe, version, lines, variant, allergens } = found;
    return c.html(
      page(
        version.title,
        html`<p class="meta"><a href="/admin/recipes">← Recipes</a></p>
          <h1>${version.title}</h1>
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

  return app;
}
