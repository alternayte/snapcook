CREATE TABLE "recipe_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recipe_id" uuid,
	"status" text DEFAULT 'reading' NOT NULL,
	"photos" text[] DEFAULT '{}' NOT NULL,
	"draft" jsonb,
	"error" text,
	"cost_usd" numeric(16, 10) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_imports_status_check" CHECK ("recipe_imports"."status" in ('reading', 'checking', 'saving', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_meter_check";--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "reviewed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "added_by_import_id" uuid;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cook_sessions" ADD COLUMN "removed_items" jsonb;--> statement-breakpoint
ALTER TABLE "recipe_imports" ADD CONSTRAINT "recipe_imports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_imports" ADD CONSTRAINT "recipe_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_imports" ADD CONSTRAINT "recipe_imports_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_imports_household_created_idx" ON "recipe_imports" USING btree ("household_id","created_at");--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_added_by_import_id_recipe_imports_id_fk" FOREIGN KEY ("added_by_import_id") REFERENCES "public"."recipe_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipes_household_idx" ON "recipes" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_meter_check" CHECK ("usage_counters"."meter" in ('snaps', 'suggestions', 'adaptations', 'rescues', 'imports'));