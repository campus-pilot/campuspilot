-- School trials (docs/school-trials.md): one row per trial of a tier given
-- to a school by a platform administrator. A trial is active while
-- starts_at <= now() < least(ends_at, coalesce(ended_at, 'infinity')); the
-- school's plan is the higher of its subscribed tier and that trial's tier.
CREATE TABLE "school_trial" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"tier" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by" text,
	"ended_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_trial_tier_check" CHECK ("school_trial"."tier" in ('plus', 'pro', 'enterprise')),
	CONSTRAINT "school_trial_ends_after_start_check" CHECK ("school_trial"."ends_at" > "school_trial"."starts_at"),
	CONSTRAINT "school_trial_ended_after_start_check" CHECK ("school_trial"."ended_at" >= "school_trial"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "school_trial" ADD CONSTRAINT "school_trial_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_trial" ADD CONSTRAINT "school_trial_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_trial" ADD CONSTRAINT "school_trial_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_trial_school_id_idx" ON "school_trial" USING btree ("school_id","starts_at");--> statement-breakpoint
CREATE INDEX "school_trial_created_by_idx" ON "school_trial" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "school_trial_ended_by_idx" ON "school_trial" USING btree ("ended_by");--> statement-breakpoint
-- No two trials of one school overlap, so a school has at most one active
-- trial. drizzle cannot declare an EXCLUDE constraint, so it is only here
-- (the schema file says so). btree_gist lets the gist index compare the
-- text school_id with =.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "school_trial" ADD CONSTRAINT "school_trial_no_overlap" EXCLUDE USING gist ("school_id" WITH =, tstzrange("starts_at", coalesce("ended_at", "ends_at")) WITH &&);
