import { zValidator } from "@hono/zod-validator";
import type { Db } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import { CreateHouseholdInput, MatchTextInput, type Me, ProfileInput } from "@snapcook/schema";
import { Hono } from "hono";
import { z } from "zod";
import { fail, type HouseholdEnv, type SessionEnv } from "../../http";
import type { IngredientMatcher } from "../pantry/match";
import {
  createHousehold,
  membership,
  profileOf,
  replaceProfile,
  unknownIngredients,
} from "./service";

async function me(db: Db, user: SessionEnv["Variables"]["user"]): Promise<Me> {
  const member = await membership(db, user.id);
  return {
    user,
    household: member?.household ?? null,
    role: member?.role ?? null,
    profile: member ? await profileOf(db, member.household.id) : null,
  };
}

/** Routes that need a signed-in user but not a household. */
export function sessionRoutes(db: Db, ownerEmails: string[]) {
  return new Hono<SessionEnv>()
    .get("/me", async (c) => c.json(await me(db, c.var.user)))
    .post(
      "/household",
      zValidator("json", CreateHouseholdInput, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "Give the household a name."),
      ),
      async (c) => {
        if (await membership(db, c.var.user.id)) {
          return fail(c, 403, "forbidden", "You already belong to a household.", {
            reason: "already_in_household",
          });
        }
        await createHousehold(db, c.var.user, c.req.valid("json").name, ownerEmails);
        return c.json(await me(db, c.var.user), 201);
      },
    );
}

const MATCH_SYSTEM = [
  "You read what a household wrote about food it does not eat or does not like.",
  "Return the canonical ingredient names from the list that the text rules out.",
  "Use only names from the list, spelled exactly as listed.",
  "A group word covers every listed member of the group: 'dairy' covers milk, cream, yoghurt, cheeses and butter; 'nuts' covers every nut.",
  "An exception removes names: 'no dairy except butter' does not include butter.",
  "Return an empty list when the text names no food.",
].join(" ");

const Matched = z.object({ names: z.array(z.string()) });

export function householdRoutes(db: Db, llm: Llm, matcher: IngredientMatcher) {
  return new Hono<HouseholdEnv>()
    .put(
      "/household/profile",
      zValidator("json", ProfileInput, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "The profile is not valid."),
      ),
      async (c) => {
        const input = c.req.valid("json");
        const unknown = await unknownIngredients(db, [
          ...input.cannot_eat,
          ...input.dislikes,
          ...input.staples,
        ]);
        if (unknown.length > 0) {
          return fail(c, 400, "validation", "Some ingredients do not exist.", { unknown });
        }
        const profile = await replaceProfile(db, c.var.household.id, c.var.user.id, input);
        return c.json({ profile });
      },
    )
    .post(
      "/household/profile/match",
      zValidator("json", MatchTextInput, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "Give a text to read."),
      ),
      async (c) => {
        const { text } = c.req.valid("json");
        let answer: z.infer<typeof Matched>;
        try {
          answer = await llm.structured(
            {
              system: MATCH_SYSTEM,
              prompt: `Text: ${text}\n\nCanonical ingredients:\n${(await matcher.names()).join(", ")}`,
            },
            Matched,
            { endpoint: "profile.match", household_id: c.var.household.id, role: "adapt" },
          );
        } catch {
          return fail(c, 502, "upstream_model", "The text could not be read. Try again.");
        }
        // The model's names are matched again here, so an invented name never reaches the client.
        const found = await Promise.all(answer.names.map((name) => matcher.match(name)));
        const unique = new Map(found.filter((f) => f !== undefined).map((f) => [f.id, f]));
        return c.json({ ingredients: [...unique.values()] });
      },
    );
}
