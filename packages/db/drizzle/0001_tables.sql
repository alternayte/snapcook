CREATE TABLE "device_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	CONSTRAINT "device_profiles_id_check" CHECK ("device_profiles"."id" in ('mc_smart'))
);
--> statement-breakpoint
CREATE TABLE "ingredient_substitutes" (
	"ingredient_id" uuid NOT NULL,
	"substitute_id" uuid NOT NULL,
	"context" text NOT NULL,
	"note" text,
	CONSTRAINT "ingredient_substitutes_ingredient_id_substitute_id_context_pk" PRIMARY KEY("ingredient_id","substitute_id","context"),
	CONSTRAINT "ingredient_substitutes_context_check" CHECK ("ingredient_substitutes"."context" in ('general', 'dairy_free', 'vegan'))
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"category" text NOT NULL,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"default_unit" text NOT NULL,
	"grams_per_unit" numeric(10, 2),
	"ml_per_unit" numeric(10, 2),
	"is_staple_default" boolean DEFAULT false NOT NULL,
	"embedding" vector(1024),
	CONSTRAINT "ingredients_name_unique" UNIQUE("name"),
	CONSTRAINT "ingredients_category_check" CHECK ("ingredients"."category" in ('vegetable', 'fruit', 'herb', 'meat', 'poultry', 'fish', 'seafood', 'dairy', 'egg', 'grain', 'pasta', 'rice', 'pulse', 'nut_seed', 'spice', 'oil_fat', 'condiment', 'sauce', 'baking', 'sweetener', 'stock', 'alcohol', 'beverage', 'other')),
	CONSTRAINT "ingredients_default_unit_check" CHECK ("ingredients"."default_unit" in ('g', 'ml', 'piece', 'tbsp', 'tsp', 'cup'))
);
--> statement-breakpoint
CREATE TABLE "recipe_device_variants" (
	"recipe_version_id" uuid NOT NULL,
	"device_profile_id" text NOT NULL,
	"steps" jsonb NOT NULL,
	"suitability" text NOT NULL,
	"notes" text,
	CONSTRAINT "recipe_device_variants_recipe_version_id_device_profile_id_pk" PRIMARY KEY("recipe_version_id","device_profile_id"),
	CONSTRAINT "recipe_device_variants_suitability_check" CHECK ("recipe_device_variants"."suitability" in ('native', 'partial', 'unsuitable'))
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"recipe_version_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" numeric(10, 2),
	"unit" text,
	"prep" text,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "recipe_ingredients_recipe_version_id_position_pk" PRIMARY KEY("recipe_version_id","position"),
	CONSTRAINT "recipe_ingredients_unit_check" CHECK ("recipe_ingredients"."unit" in ('g', 'ml', 'piece', 'tbsp', 'tsp', 'cup')),
	CONSTRAINT "recipe_ingredients_role_check" CHECK ("recipe_ingredients"."role" in ('core', 'supporting', 'staple', 'optional'))
);
--> statement-breakpoint
CREATE TABLE "recipe_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_reports_kind_check" CHECK ("recipe_reports"."kind" in ('rating', 'off', 'rescue'))
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipe_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"cuisine" text NOT NULL,
	"dish_type" text NOT NULL,
	"primary_protein" text NOT NULL,
	"technique" text NOT NULL,
	"time_total_min" integer NOT NULL,
	"time_active_min" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"base_servings" integer NOT NULL,
	"description" text NOT NULL,
	"steps" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"failure_modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_versions_recipe_version_unique" UNIQUE("recipe_id","version")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	CONSTRAINT "recipes_slug_unique" UNIQUE("slug"),
	CONSTRAINT "recipes_status_check" CHECK ("recipes"."status" in ('draft', 'auto_reviewed', 'human_reviewed', 'test_cooked', 'hidden'))
);
--> statement-breakpoint
CREATE TABLE "adaptations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"controls" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"model" text NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adaptations_household_input_hash_unique" UNIQUE("household_id","input_hash")
);
--> statement-breakpoint
CREATE TABLE "cook_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"adaptation_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"current_step" integer DEFAULT 0 NOT NULL,
	"deductions" jsonb,
	"rating" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "household_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" uuid,
	CONSTRAINT "household_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_user_id_pk" PRIMARY KEY("household_id","user_id"),
	CONSTRAINT "household_members_user_unique" UNIQUE("user_id"),
	CONSTRAINT "household_members_role_check" CHECK ("household_members"."role" in ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "household_profiles" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cannot_eat" uuid[] DEFAULT '{}' NOT NULL,
	"cannot_eat_text" text,
	"dislikes" uuid[] DEFAULT '{}' NOT NULL,
	"diet_style" text DEFAULT 'none' NOT NULL,
	"toddler" boolean DEFAULT false NOT NULL,
	"devices" jsonb NOT NULL,
	"default_servings" numeric(10, 2) NOT NULL,
	"default_time_min" integer NOT NULL,
	"effort" text DEFAULT 'normal' NOT NULL,
	"staples" uuid[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "household_profiles_diet_style_check" CHECK ("household_profiles"."diet_style" in ('none', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher')),
	CONSTRAINT "household_profiles_effort_check" CHECK ("household_profiles"."effort" in ('lazy', 'normal'))
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_owner_user_id_unique" UNIQUE("owner_user_id"),
	CONSTRAINT "households_plan_check" CHECK ("households"."plan" in ('free', 'pro', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "pantry_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"display_name" text NOT NULL,
	"quantity" numeric(10, 2),
	"unit" text,
	"location" text NOT NULL,
	"source" text NOT NULL,
	"confidence" numeric(10, 2),
	"use_soon" boolean DEFAULT false NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_items_unit_check" CHECK ("pantry_items"."unit" in ('g', 'ml', 'piece', 'tbsp', 'tsp', 'cup')),
	CONSTRAINT "pantry_items_location_check" CHECK ("pantry_items"."location" in ('fridge', 'freezer', 'pantry', 'counter')),
	CONSTRAINT "pantry_items_source_check" CHECK ("pantry_items"."source" in ('photo', 'manual', 'shopping_list', 'draw_down'))
);
--> statement-breakpoint
CREATE TABLE "saved_recipes" (
	"household_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_recipes_household_id_recipe_id_pk" PRIMARY KEY("household_id","recipe_id")
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"display_name" text NOT NULL,
	"quantity" numeric(10, 2),
	"unit" text,
	"aisle" text NOT NULL,
	"wanted_by" uuid[] DEFAULT '{}' NOT NULL,
	"bought" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_items_unit_check" CHECK ("shopping_items"."unit" in ('g', 'ml', 'piece', 'tbsp', 'tsp', 'cup')),
	CONSTRAINT "shopping_items_aisle_check" CHECK ("shopping_items"."aisle" in ('produce', 'meat_fish', 'dairy', 'pantry', 'frozen', 'other'))
);
--> statement-breakpoint
CREATE TABLE "snaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"location" text NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"proposals" jsonb,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "snaps_location_check" CHECK ("snaps"."location" in ('fridge', 'freezer', 'pantry', 'counter')),
	CONSTRAINT "snaps_status_check" CHECK ("snaps"."status" in ('queued', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"rc_app_user_id" text NOT NULL,
	"entitlement" text,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('active', 'in_trial', 'billing_issue', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "suggestion_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"pantry_snapshot" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"household_id" uuid NOT NULL,
	"period" text NOT NULL,
	"meter" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_household_id_period_meter_pk" PRIMARY KEY("household_id","period","meter"),
	CONSTRAINT "usage_counters_meter_check" CHECK ("usage_counters"."meter" in ('snaps', 'suggestions', 'adaptations', 'rescues'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ingredient_substitutes" ADD CONSTRAINT "ingredient_substitutes_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_substitutes" ADD CONSTRAINT "ingredient_substitutes_substitute_id_ingredients_id_fk" FOREIGN KEY ("substitute_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_device_variants" ADD CONSTRAINT "recipe_device_variants_recipe_version_id_recipe_versions_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_device_variants" ADD CONSTRAINT "recipe_device_variants_device_profile_id_device_profiles_id_fk" FOREIGN KEY ("device_profile_id") REFERENCES "public"."device_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_version_id_recipe_versions_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_reports" ADD CONSTRAINT "recipe_reports_recipe_version_id_recipe_versions_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_reports" ADD CONSTRAINT "recipe_reports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_current_version_id_recipe_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptations" ADD CONSTRAINT "adaptations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptations" ADD CONSTRAINT "adaptations_recipe_version_id_recipe_versions_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_sessions" ADD CONSTRAINT "cook_sessions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_sessions" ADD CONSTRAINT "cook_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_sessions" ADD CONSTRAINT "cook_sessions_adaptation_id_adaptations_id_fk" FOREIGN KEY ("adaptation_id") REFERENCES "public"."adaptations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_profiles" ADD CONSTRAINT "household_profiles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_recipes" ADD CONSTRAINT "saved_recipes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_recipes" ADD CONSTRAINT "saved_recipes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snaps" ADD CONSTRAINT "snaps_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snaps" ADD CONSTRAINT "snaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_runs" ADD CONSTRAINT "suggestion_runs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredients_embedding_idx" ON "ingredients" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "recipe_ingredients_ingredient_role_idx" ON "recipe_ingredients" USING btree ("ingredient_id","role");--> statement-breakpoint
CREATE INDEX "recipe_reports_version_resolved_idx" ON "recipe_reports" USING btree ("recipe_version_id","resolved");--> statement-breakpoint
CREATE INDEX "recipe_versions_embedding_idx" ON "recipe_versions" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "cook_sessions_household_started_idx" ON "cook_sessions" USING btree ("household_id","started_at");--> statement-breakpoint
CREATE INDEX "pantry_items_household_ingredient_location_idx" ON "pantry_items" USING btree ("household_id","ingredient_id","location");--> statement-breakpoint
CREATE INDEX "shopping_items_household_idx" ON "shopping_items" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "snaps_household_created_idx" ON "snaps" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "suggestion_runs_household_created_idx" ON "suggestion_runs" USING btree ("household_id","created_at");