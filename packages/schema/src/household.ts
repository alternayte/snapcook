import { z } from "zod";
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
