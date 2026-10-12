import { zValidator } from "@hono/zod-validator";
import { type Db, schema } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import type { IngredientMatcher } from "@snapcook/recognition";
import {
  CreateHouseholdInput,
  Id,
  JoinHouseholdInput,
  MatchTextInput,
  type Me,
  ProfileInput,
} from "@snapcook/schema";
import { eq, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fail, type HouseholdEnv, type SessionEnv } from "../../http";
import { entitlements } from "../billing/usage";
import {
  createHousehold,
  membership,
  profileOf,
  replaceProfile,
  unknownIngredients,
} from "./service";
import { createInvite, joinHousehold, members, removeMember } from "./sharing";

async function me(db: Db, user: SessionEnv["Variables"]["user"]): Promise<Me> {
  const member = await membership(db, user.id);
  return {
    user,
    household: member?.household ?? null,
    role: member?.role ?? null,
    profile: member ? await profileOf(db, member.household.id) : null,
    entitlements: member ? await entitlements(db, member.household) : null,
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
    )
    .post(
      "/household/join",
      zValidator("json", JoinHouseholdInput, (result, c) =>
        result.success ? undefined : fail(c, 400, "validation", "The code has six characters."),
      ),
      async (c) => {
        const outcome = await joinHousehold(db, c.var.user.id, c.req.valid("json").code);
        if (outcome === "already_in_household") {
          return fail(c, 403, "forbidden", "You already belong to a household.", {
            reason: "already_in_household",
          });
        }
        if (outcome === "household_full") {
          return fail(c, 403, "forbidden", "That household has no room on its plan.", {
            reason: "household_full",
          });
        }
        if (outcome === "bad_code") {
          return fail(c, 404, "not_found", "That code is not valid, or it has been used.");
        }
        return c.json(await me(db, c.var.user));
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
  const { ingredients } = schema;
  return new Hono<HouseholdEnv>()
    .get("/household/members", async (c) =>
      c.json({ members: await members(db, c.var.household.id) }),
    )
    .post("/household/invites", async (c) =>
      c.json(await createInvite(db, c.var.household.id), 201),
    )
    .delete(
      "/household/members/:userId",
      zValidator("param", z.object({ userId: Id }), (result, c) =>
        result.success ? undefined : fail(c, 404, "not_found", "No such member."),
      ),
      async (c) => {
        const outcome = await removeMember(
          db,
          c.var.household.id,
          { id: c.var.user.id, role: c.var.role },
          c.req.valid("param").userId,
        );
        if (outcome === "not_found") return fail(c, 404, "not_found", "No such member.");
        if (outcome === "forbidden") {
          return fail(c, 403, "forbidden", "Only the owner can remove another member.");
        }
        return c.body(null, 204);
      },
    )
    .get("/household/profile", async (c) => {
      const profile = await profileOf(db, c.var.household.id);
      if (!profile) return fail(c, 404, "not_found", "This household has no profile.");
      // The profile holds ingredient ids. The client also needs their names, and the staples
      // a household may tick.
      const used = [...profile.cannot_eat, ...profile.dislikes, ...profile.staples];
      const rows = await db
        .select({
          id: ingredients.id,
          name: ingredients.name,
          staple: ingredients.is_staple_default,
        })
        .from(ingredients)
        .where(or(eq(ingredients.is_staple_default, true), inArray(ingredients.id, used)))
        .orderBy(ingredients.name);
      return c.json({
        profile,
        names: Object.fromEntries(rows.map((r) => [r.id, r.name])),
        staple_options: rows.filter((r) => r.staple).map(({ id, name }) => ({ id, name })),
      });
    })
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
