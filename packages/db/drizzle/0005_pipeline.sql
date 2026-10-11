CREATE TABLE "dish_stage_outputs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"candidate_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"attempt" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dish_stage_outputs_candidate_stage_attempt_unique" UNIQUE("candidate_id","stage","attempt"),
	CONSTRAINT "dish_stage_outputs_stage_check" CHECK ("dish_stage_outputs"."stage" in ('research', 'write', 'device', 'validate', 'review'))
);
--> statement-breakpoint
ALTER TABLE "dish_candidates" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "dish_stage_outputs" ADD CONSTRAINT "dish_stage_outputs_candidate_id_dish_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."dish_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish_candidates" ADD CONSTRAINT "dish_candidates_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;