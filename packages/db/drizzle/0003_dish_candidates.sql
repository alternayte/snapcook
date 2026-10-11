CREATE TABLE "dish_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"cuisine" text NOT NULL,
	"dish_type" text NOT NULL,
	"primary_protein" text NOT NULL,
	"technique" text NOT NULL,
	"time_band" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"similar_to" uuid,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dish_candidates_name_unique" UNIQUE("name"),
	CONSTRAINT "dish_candidates_status_check" CHECK ("dish_candidates"."status" in ('proposed', 'kept', 'dropped'))
);
--> statement-breakpoint
ALTER TABLE "dish_candidates" ADD CONSTRAINT "dish_candidates_similar_to_dish_candidates_id_fk" FOREIGN KEY ("similar_to") REFERENCES "public"."dish_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dish_candidates_cuisine_idx" ON "dish_candidates" USING btree ("cuisine");