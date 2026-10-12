CREATE TABLE "recipe_images" (
	"recipe_version_id" uuid PRIMARY KEY NOT NULL,
	"file" text,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"findings" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_images" ADD CONSTRAINT "recipe_images_recipe_version_id_recipe_versions_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE cascade ON UPDATE no action;