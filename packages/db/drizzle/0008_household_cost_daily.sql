CREATE TABLE "household_cost_daily" (
	"household_id" uuid NOT NULL,
	"day" date NOT NULL,
	"cost_usd" numeric(16, 10) NOT NULL,
	"calls" integer NOT NULL,
	CONSTRAINT "household_cost_daily_household_id_day_pk" PRIMARY KEY("household_id","day")
);
--> statement-breakpoint
ALTER TABLE "household_cost_daily" ADD CONSTRAINT "household_cost_daily_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;