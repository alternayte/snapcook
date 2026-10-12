import { z } from "zod";
import { Entitlements } from "./billing";
import { Allergen, DietStyle, Effort, Id, MemberRole, Plan } from "./enums";

export const User = z.object({
  id: Id,
  name: z.string(),
  email: z.email(),
  email_verified: z.boolean(),
  image: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type User = z.infer<typeof User>;

export const Household = z.object({
  id: Id,
  owner_user_id: Id,
  name: z.string().min(1),
  plan: Plan,
  /** Change stamps. Each goes up by one on any write to that part of the household's data. */
  pantry_rev: z.number().int().nonnegative(),
  list_rev: z.number().int().nonnegative(),
  profile_rev: z.number().int().nonnegative(),
  created_at: z.date(),
});
export type Household = z.infer<typeof Household>;

export const HouseholdMember = z.object({
  household_id: Id,
  user_id: Id,
  role: MemberRole,
  joined_at: z.date(),
});
export type HouseholdMember = z.infer<typeof HouseholdMember>;

export const INVITE_CODE_LENGTH = 6;

export const HouseholdInvite = z.object({
  id: Id,
  household_id: Id,
  code: z.string().length(INVITE_CODE_LENGTH),
  expires_at: z.date(),
  used_by: Id.nullable(),
});
export type HouseholdInvite = z.infer<typeof HouseholdInvite>;

export const ProfileAllergen = z.object({ value: Allergen, added_by: Id });
export type ProfileAllergen = z.infer<typeof ProfileAllergen>;

export const ProfileDevices = z.object({ mc_smart: z.boolean() });
export type ProfileDevices = z.infer<typeof ProfileDevices>;

export const HouseholdProfile = z.object({
  household_id: Id,
  allergens: z.array(ProfileAllergen),
  cannot_eat: z.array(Id),
  cannot_eat_text: z.string().nullable(),
  dislikes: z.array(Id),
  diet_style: DietStyle,
  toddler: z.boolean(),
  devices: ProfileDevices,
  default_servings: z.number().positive().multipleOf(0.5),
  default_time_min: z.number().int().positive(),
  effort: Effort,
  staples: z.array(Id),
});
export type HouseholdProfile = z.infer<typeof HouseholdProfile>;

/** What a client sends to replace the profile. The server records who added each allergen. */
export const ProfileInput = HouseholdProfile.omit({ household_id: true, allergens: true }).extend({
  allergens: z.array(Allergen),
  cannot_eat_text: z.string().max(500).nullable(),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const CreateHouseholdInput = z.object({ name: z.string().trim().min(1).max(60) });
export type CreateHouseholdInput = z.infer<typeof CreateHouseholdInput>;

/** Everything the app needs to start: who is signed in, and their household if they have one. */
export const Me = z.object({
  user: User.pick({ id: true, name: true, email: true }),
  household: Household.nullable(),
  role: MemberRole.nullable(),
  profile: HouseholdProfile.nullable(),
  entitlements: Entitlements.nullable(),
});
export type Me = z.infer<typeof Me>;

export const MatchTextInput = z.object({ text: z.string().trim().min(1).max(500) });
export type MatchTextInput = z.infer<typeof MatchTextInput>;

export const JoinHouseholdInput = z.object({
  code: z.string().trim().toUpperCase().length(INVITE_CODE_LENGTH),
});

export const InviteView = z.object({ code: z.string(), expires_at: z.date() });
export type InviteView = z.infer<typeof InviteView>;

export const MemberView = z.object({
  user_id: Id,
  name: z.string(),
  email: z.string(),
  role: MemberRole,
  joined_at: z.date(),
});
export type MemberView = z.infer<typeof MemberView>;
