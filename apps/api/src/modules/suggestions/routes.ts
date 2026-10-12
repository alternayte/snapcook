import { zValidator } from "@hono/zod-validator";
import { Id, SuggestInput } from "@snapcook/schema";
import { Hono } from "hono";
import { z } from "zod";
import { fail, type HouseholdEnv } from "../../http";
import { profileOf } from "../household/service";
import { type SuggestDeps, suggest } from "./service";

export function suggestionRoutes(deps: SuggestDeps) {
  return new Hono<HouseholdEnv>().post(
    "/suggestions",
    zValidator("query", z.object({ cursor: Id.optional() }), (result, c) =>
      result.success ? undefined : fail(c, 400, "validation", "The cursor is not valid."),
    ),
    zValidator("json", SuggestInput, (result, c) =>
      result.success ? undefined : fail(c, 400, "validation", "The request is not valid."),
    ),
    async (c) => {
      const profile = await profileOf(deps.db, c.var.household.id);
      if (!profile) return fail(c, 404, "not_found", "This household has no profile.");
      const answer = await suggest(
        deps,
        c.var.household,
        profile,
        c.req.valid("json"),
        c.req.valid("query").cursor,
      );
      return answer ? c.json(answer) : fail(c, 404, "not_found", "No such run.");
    },
  );
}
