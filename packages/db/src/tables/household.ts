import {
  type AdaptationControls,
  type AdaptedRecipe,
  Aisle,
  type Deduction,
  DietStyle,
  Effort,
  Location,
  MemberRole,
  Meter,
  type PantrySnapshotLine,
  PantrySource,
  Plan,
  type ProfileAllergen,
  type ProfileDevices,
  type SnapProposal,
  SnapStatus,
  SubscriptionStatus,
  type SuggestionResult,
  type SuggestRequest,
  Unit,
} from "@snapcook/schema";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, enumCheck, enumText, id, quantity, timestamptz, usd } from "../columns";
import { ingredients, recipes, recipeVersions } from "./corpus";

export const users = pgTable("users", {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  email_verified: boolean().notNull().default(false),
  image: text(),
  created_at: createdAt(),
  updated_at: timestamptz().notNull().defaultNow(),
});

export const households = pgTable(
  "households",
  {
    id: id(),
    owner_user_id: uuid()
      .notNull()
      .unique()
      .references(() => users.id),
    name: text().notNull(),
    plan: enumText(Plan).notNull().default("free"),
    pantry_rev: integer().notNull().default(0),
    list_rev: integer().notNull().default(0),
    profile_rev: integer().notNull().default(0),
    created_at: createdAt(),
  },
  (t) => [enumCheck("households_plan_check", t.plan, Plan.options)],
);

export const householdMembers = pgTable(
  "household_members",
  {
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    user_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: enumText(MemberRole).notNull(),
    joined_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.household_id, t.user_id] }),
    // A user belongs to one household.
    unique("household_members_user_unique").on(t.user_id),
    enumCheck("household_members_role_check", t.role, MemberRole.options),
  ],
);

export const householdInvites = pgTable("household_invites", {
  id: id(),
  household_id: uuid()
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  code: text().notNull().unique(),
  expires_at: timestamptz().notNull(),
  used_by: uuid().references(() => users.id),
});

export const householdProfiles = pgTable(
  "household_profiles",
  {
    household_id: uuid()
      .primaryKey()
      .references(() => households.id, { onDelete: "cascade" }),
    allergens: jsonb().$type<ProfileAllergen[]>().notNull().default([]),
    cannot_eat: uuid().array().notNull().default([]),
    cannot_eat_text: text(),
    dislikes: uuid().array().notNull().default([]),
    diet_style: enumText(DietStyle).notNull().default("none"),
    toddler: boolean().notNull().default(false),
    devices: jsonb().$type<ProfileDevices>().notNull(),
    default_servings: quantity().notNull(),
    default_time_min: integer().notNull(),
    effort: enumText(Effort).notNull().default("normal"),
    staples: uuid().array().notNull().default([]),
  },
  (t) => [
    enumCheck("household_profiles_diet_style_check", t.diet_style, DietStyle.options),
    enumCheck("household_profiles_effort_check", t.effort, Effort.options),
  ],
);

export const pantryItems = pgTable(
  "pantry_items",
  {
    id: id(),
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    ingredient_id: uuid().references(() => ingredients.id),
    display_name: text().notNull(),
    quantity: quantity(),
    unit: enumText(Unit),
    location: enumText(Location).notNull(),
    source: enumText(PantrySource).notNull(),
    confidence: quantity(),
    use_soon: boolean().notNull().default(false),
    expires_on: date({ mode: "string" }),
    created_at: createdAt(),
    updated_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("pantry_items_household_ingredient_location_idx").on(
      t.household_id,
      t.ingredient_id,
      t.location,
    ),
    enumCheck("pantry_items_unit_check", t.unit, Unit.options),
    enumCheck("pantry_items_location_check", t.location, Location.options),
    enumCheck("pantry_items_source_check", t.source, PantrySource.options),
  ],
);

export const snaps = pgTable(
  "snaps",
  {
    id: id(),
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    user_id: uuid()
      .notNull()
      .references(() => users.id),
    location: enumText(Location).notNull(),
    storage_path: text().notNull(),
    status: enumText(SnapStatus).notNull().default("queued"),
    proposals: jsonb().$type<SnapProposal[]>(),
    cost_usd: usd(),
    created_at: createdAt(),
    deleted_at: timestamptz(),
  },
  (t) => [
    index("snaps_household_created_idx").on(t.household_id, t.created_at),
    enumCheck("snaps_location_check", t.location, Location.options),
    enumCheck("snaps_status_check", t.status, SnapStatus.options),
  ],
);

export const suggestionRuns = pgTable(
  "suggestion_runs",
  {
    id: id(),
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    request: jsonb().$type<SuggestRequest>().notNull(),
    pantry_snapshot: jsonb().$type<PantrySnapshotLine[]>().notNull(),
    results: jsonb().$type<SuggestionResult[]>().notNull(),
    created_at: createdAt(),
  },
  (t) => [index("suggestion_runs_household_created_idx").on(t.household_id, t.created_at)],
);

export const adaptations = pgTable(
  "adaptations",
  {
    id: id(),
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    recipe_version_id: uuid()
      .notNull()
      .references(() => recipeVersions.id),
    input_hash: text().notNull(),
    controls: jsonb().$type<AdaptationControls>().notNull(),
    output: jsonb().$type<AdaptedRecipe>().notNull(),
    model: text().notNull(),
    cost_usd: usd().notNull(),
    created_at: createdAt(),
  },
  (t) => [unique("adaptations_household_input_hash_unique").on(t.household_id, t.input_hash)],
);

export const cookSessions = pgTable(
  "cook_sessions",
  {
    id: id(),
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    user_id: uuid()
      .notNull()
      .references(() => users.id),
    adaptation_id: uuid()
      .notNull()
      .references(() => adaptations.id),
    started_at: timestamptz().notNull().defaultNow(),
    finished_at: timestamptz(),
    current_step: integer().notNull().default(0),
    deductions: jsonb().$type<Deduction[]>(),
    rating: integer(),
    notes: text(),
  },
  (t) => [index("cook_sessions_household_started_idx").on(t.household_id, t.started_at)],
);

export const savedRecipes = pgTable(
  "saved_recipes",
  {
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    recipe_id: uuid()
      .notNull()
      .references(() => recipes.id),
    saved_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.household_id, t.recipe_id] })],
);

export const shoppingItems = pgTable(
  "shopping_items",
  {
    id: id(),
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    ingredient_id: uuid().references(() => ingredients.id),
    display_name: text().notNull(),
    quantity: quantity(),
    unit: enumText(Unit),
    aisle: enumText(Aisle).notNull(),
    wanted_by: uuid().array().notNull().default([]),
    bought: boolean().notNull().default(false),
    created_at: createdAt(),
  },
  (t) => [
    index("shopping_items_household_idx").on(t.household_id),
    enumCheck("shopping_items_unit_check", t.unit, Unit.options),
    enumCheck("shopping_items_aisle_check", t.aisle, Aisle.options),
  ],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    period: text().notNull(),
    meter: enumText(Meter).notNull(),
    used: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.household_id, t.period, t.meter] }),
    enumCheck("usage_counters_meter_check", t.meter, Meter.options),
  ],
);

export const householdCostDaily = pgTable(
  "household_cost_daily",
  {
    household_id: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    cost_usd: usd().notNull(),
    calls: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.household_id, t.day] })],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    household_id: uuid()
      .primaryKey()
      .references(() => households.id, { onDelete: "cascade" }),
    rc_app_user_id: text().notNull(),
    entitlement: text(),
    status: enumText(SubscriptionStatus).notNull(),
    expires_at: timestamptz(),
    raw: jsonb().$type<Record<string, unknown>>().notNull(),
    updated_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [enumCheck("subscriptions_status_check", t.status, SubscriptionStatus.options)],
);
