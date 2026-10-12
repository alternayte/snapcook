import { type Db, schema } from "@snapcook/db";
import type { Household, HouseholdProfile, MemberRole, ProfileInput } from "@snapcook/schema";
import { eq, inArray } from "drizzle-orm";

const { householdMembers, householdProfiles, households, ingredients } = schema;

// What a new household starts with, until its owner changes the profile.
const DEFAULT_SERVINGS = 2.5;
const DEFAULT_TIME_MIN = 45;

/** The household a user belongs to and their role in it, or undefined. */
export async function membership(
  db: Db,
  userId: string,
): Promise<{ household: Household; role: MemberRole } | undefined> {
  const [row] = await db
    .select({ household: households, role: householdMembers.role })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.household_id))
    .where(eq(householdMembers.user_id, userId));
  return row;
}

export async function profileOf(db: Db, householdId: string): Promise<HouseholdProfile | null> {
  const [row] = await db
    .select()
    .from(householdProfiles)
    .where(eq(householdProfiles.household_id, householdId));
  return row ?? null;
}

/** Creates a household owned by the user, with its default profile. */
export async function createHousehold(
  db: Db,
  user: { id: string; email: string },
  name: string,
  ownerEmails: string[],
) {
  return db.transaction(async (tx) => {
    const plan = ownerEmails.includes(user.email.toLowerCase()) ? "owner" : "free";
    const [household] = await tx
      .insert(households)
      .values({ owner_user_id: user.id, name, plan })
      .returning();
    if (!household) throw new Error("household insert returned nothing");
    await tx
      .insert(householdMembers)
      .values({ household_id: household.id, user_id: user.id, role: "owner" });
    const staples = await tx
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(eq(ingredients.is_staple_default, true));
    await tx.insert(householdProfiles).values({
      household_id: household.id,
      devices: { mc_smart: false },
      default_servings: DEFAULT_SERVINGS,
      default_time_min: DEFAULT_TIME_MIN,
      staples: staples.map((s) => s.id),
    });
    return household.id;
  });
}

/** The ingredient ids in the list that do not exist. */
export async function unknownIngredients(db: Db, ids: string[]) {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  const found = await db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(inArray(ingredients.id, wanted));
  const known = new Set(found.map((f) => f.id));
  return wanted.filter((id) => !known.has(id));
}

/** Replaces the profile. An allergen that was already listed keeps the member who added it. */
export async function replaceProfile(
  db: Db,
  householdId: string,
  userId: string,
  input: ProfileInput,
) {
  const current = await profileOf(db, householdId);
  const addedBy = new Map(current?.allergens.map((a) => [a.value, a.added_by]));
  const { allergens, ...rest } = input;
  const values = {
    ...rest,
    allergens: [...new Set(allergens)].map((value) => ({
      value,
      added_by: addedBy.get(value) ?? userId,
    })),
  };
  const [row] = await db
    .insert(householdProfiles)
    .values({ household_id: householdId, ...values })
    .onConflictDoUpdate({ target: householdProfiles.household_id, set: values })
    .returning();
  if (!row) throw new Error("profile upsert returned nothing");
  return row;
}
