import { zValidator } from "@hono/zod-validator";
import { AdaptRequest, Id } from "@snapcook/schema";
import { Hono } from "hono";
import { z } from "zod";
import { allowanceExceeded, fail, type HouseholdEnv } from "../../http";
import { AllowanceUsedUp } from "../billing/usage";
import { profileOf } from "../household/service";
import { AdaptationRefused, type AdaptDeps, adapt, recipeView } from "./service";

export function recipeRoutes(deps: AdaptDeps) {
  return new Hono<HouseholdEnv>()
    .get(
      "/recipes/:recipeId",
      zValidator("param", z.object({ recipeId: Id }), (result, c) =>
        result.success ? undefined : fail(c, 404, "not_found", "No such recipe."),
      ),
      async (c) => {
        const recipe = await recipeView(deps.db, c.req.valid("param").recipeId);
        return recipe ? c.json(recipe) : fail(c, 404, "not_found", "No such recipe.");
      },
    )
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
