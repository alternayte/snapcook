import { randomInt } from "node:crypto";
import { type Db, schema } from "@snapcook/db";
import { INVITE_CODE_LENGTH, type InviteView, type MemberView } from "@snapcook/schema";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { PLANS } from "../billing/plans";

const { householdInvites, householdMembers, households, users } = schema;

const INVITE_DAYS = 7;
// Letters and digits that are hard to mix up when read aloud or typed: no 0/O, 1/I/L.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_TRIES = 5;

const newCode = () =>
  Array.from({ length: INVITE_CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** Makes a code that lets one person join the household within a week. */
export async function createInvite(
  db: Db,
  householdId: string,
  now = new Date(),
): Promise<InviteView> {
  const expires_at = new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < CODE_TRIES; attempt += 1) {
    // A code that is already taken is rare; another is drawn.
    const [invite] = await db
      .insert(householdInvites)
      .values({ household_id: householdId, code: newCode(), expires_at })
      .onConflictDoNothing()
      .returning({ code: householdInvites.code, expires_at: householdInvites.expires_at });
    if (invite) return invite;
  }
  throw new Error("no free invite code");
}

export type JoinOutcome = "joined" | "already_in_household" | "bad_code" | "household_full";

/** Adds the user to the household the code belongs to. A code works once and until it expires. */
export async function joinHousehold(db: Db, userId: string, code: string, now = new Date()) {
  return db.transaction(async (tx): Promise<JoinOutcome> => {
    const [member] = await tx
      .select({ id: householdMembers.user_id })
      .from(householdMembers)
      .where(eq(householdMembers.user_id, userId));
    if (member) return "already_in_household";
    const [invite] = await tx
      .select()
      .from(householdInvites)
      .where(
        and(
          eq(householdInvites.code, code),
          isNull(householdInvites.used_by),
          gt(householdInvites.expires_at, now),
        ),
      )
      .for("update");
    if (!invite) return "bad_code";
    // The household row is locked, so two people joining at once cannot both take the last place.
    const [household] = await tx
      .select({ plan: households.plan })
      .from(households)
      .where(eq(households.id, invite.household_id))
      .for("update");
    const count = await tx.$count(
      householdMembers,
      eq(householdMembers.household_id, invite.household_id),
    );
    if (!household || count >= PLANS[household.plan].members) return "household_full";
    await tx
      .insert(householdMembers)
      .values({ household_id: invite.household_id, user_id: userId, role: "member" });
    await tx
      .update(householdInvites)
      .set({ used_by: userId })
      .where(eq(householdInvites.id, invite.id));
    return "joined";
  });
}

export async function members(db: Db, householdId: string): Promise<MemberView[]> {
  return db
    .select({
      user_id: users.id,
      name: users.name,
      email: users.email,
      role: householdMembers.role,
      joined_at: householdMembers.joined_at,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.user_id))
    .where(eq(householdMembers.household_id, householdId))
    .orderBy(asc(householdMembers.joined_at));
}

export type RemoveOutcome = "removed" | "forbidden" | "not_found";

/**
 * Takes a member out of the household. The owner can remove anyone but themselves; a member can
 * remove only themselves, which is leaving. No data moves with them.
 */
export async function removeMember(
  db: Db,
  householdId: string,
  actor: { id: string; role: "owner" | "member" },
  targetId: string,
): Promise<RemoveOutcome> {
  const [target] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, targetId)),
    );
  if (!target) return "not_found";
  if (target.role === "owner") return "forbidden";
  if (actor.role !== "owner" && actor.id !== targetId) return "forbidden";
  await db
    .delete(householdMembers)
    .where(
      and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, targetId)),
    );
  return "removed";
}
