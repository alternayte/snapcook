ALTER TABLE "cook_sessions" DROP CONSTRAINT "cook_sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "household_invites" DROP CONSTRAINT "household_invites_used_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "recipe_imports" DROP CONSTRAINT "recipe_imports_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "snaps" DROP CONSTRAINT "snaps_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "cook_sessions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_imports" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "snaps" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "orphaned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cook_sessions" ADD CONSTRAINT "cook_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_imports" ADD CONSTRAINT "recipe_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snaps" ADD CONSTRAINT "snaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;