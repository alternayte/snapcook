import { zValidator } from "@hono/zod-validator";
import { schema } from "@snapcook/db";
import { AdaptRequest, BrowseQuery, Id } from "@snapcook/schema";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { allowanceExceeded, fail, type HouseholdEnv } from "../../http";
import { AllowanceUsedUp } from "../billing/usage";
import { profileOf } from "../household/service";
import type { CorpusReader } from "../suggestions/service";
import { browse } from "./browse";
import { AdaptationRefused, type AdaptDeps, adapt, recipeView } from "./service";

const { recipes } = schema;

export function recipeRoutes(deps: AdaptDeps & { corpus: CorpusReader }) {
  const recipeParam = zValidator("param", z.object({ recipeId: Id }), (result, c) =>
    result.success ? undefined : fail(c, 404, "not_found", "No such recipe."),
  );

  /** Sets when the household's own recipe was shared, or clears it. */
  const setShared = async (householdId: string, recipeId: string, shared: boolean) => {
    const [own] = await deps.db
      .select({ removed_at: recipes.removed_at })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.household_id, householdId)));
    if (!own) return "missing" as const;
    if (shared && own.removed_at) return "removed" as const;
    await deps.db
      .update(recipes)
      .set({ shared_at: shared ? new Date() : null })
      .where(eq(recipes.id, recipeId));
    deps.corpus.invalidate();
    return "done" as const;
  };

  return new Hono<HouseholdEnv>()
    .get(
      "/recipes",
      zValidator("query", BrowseQuery, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "The filters are not valid."),
      ),
      async (c) => {
        const profile = await profileOf(deps.db, c.var.household.id);
        if (!profile) return fail(c, 404, "not_found", "This household has no profile.");
        return c.json(
          await browse(deps.db, deps.corpus, c.var.household, profile, c.req.valid("query")),
        );
      },
    )
    .post("/recipes/:recipeId/share", recipeParam, async (c) => {
      const result = await setShared(c.var.household.id, c.req.valid("param").recipeId, true);
      if (result === "missing") return fail(c, 404, "not_found", "No such recipe.");
      if (result === "removed") {
        return fail(c, 403, "forbidden", "This recipe was taken off the community list.", {
          reason: "removed",
        });
      }
      return c.body(null, 204);
    })
    .delete("/recipes/:recipeId/share", recipeParam, async (c) => {
      const result = await setShared(c.var.household.id, c.req.valid("param").recipeId, false);
      return result === "missing"
        ? fail(c, 404, "not_found", "No such recipe.")
        : c.body(null, 204);
    })
    .get("/recipes/:recipeId", recipeParam, async (c) => {
      const recipe = await recipeView(deps.db, c.var.household.id, c.req.valid("param").recipeId);
      return recipe ? c.json(recipe) : fail(c, 404, "not_found", "No such recipe.");
    })
    .post(
      "/adaptations",
      zValidator("json", AdaptRequest, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "The request is not valid."),
      ),
      async (c) => {
        const profile = await profileOf(deps.db, c.var.household.id);
        if (!profile) return fail(c, 404, "not_found", "This household has no profile.");
        try {
          const answer = await adapt(deps, c.var.household, profile, c.req.valid("json"));
          return answer ? c.json(answer) : fail(c, 404, "not_found", "No such recipe.");
        } catch (error) {
          if (error instanceof AllowanceUsedUp) return allowanceExceeded(c, error.refusal);
          if (error instanceof AdaptationRefused) {
            return fail(c, 422, "adaptation_refused", "This recipe could not be adapted safely.", {
              problems: error.problems,
            });
          }
          return fail(c, 502, "upstream_model", "The recipe could not be adapted. Try again.");
        }
      },
    );
}
