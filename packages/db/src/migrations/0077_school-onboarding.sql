-- Guided setup for self-created schools (docs/school-creation.md, "Guided
-- setup"). A row exists only for a school that is offered the guide; it is
-- written when a person creates their own school. Existing schools get no row
-- and never see it. Finishing the guide and choosing to set up later are
-- separate facts.
CREATE TABLE "school_onboarding" (
	"school_id" text PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_onboarding" ADD CONSTRAINT "school_onboarding_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;