CREATE TABLE "llm_calls" (
	"id" uuid NOT NULL,
	"household_id" uuid,
	"endpoint" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"cost_usd" numeric(16, 10) NOT NULL,
	"latency_ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_calls_id_created_at_pk" PRIMARY KEY("id","created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE INDEX "llm_calls_household_created_idx" ON "llm_calls" ("household_id","created_at");
