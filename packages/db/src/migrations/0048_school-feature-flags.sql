CREATE TABLE "school_feature_flag" (
	"school_id" text NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean NOT NULL,
	"config" jsonb,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_feature_flag_school_id_feature_pk" PRIMARY KEY("school_id","feature")
);
--> statement-breakpoint
ALTER TABLE "school_feature_flag" ADD CONSTRAINT "school_feature_flag_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_feature_flag" ADD CONSTRAINT "school_feature_flag_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_feature_flag_updated_by_idx" ON "school_feature_flag" USING btree ("updated_by");--> statement-breakpoint
-- The Cadet Portal was available to every school before it became a
-- per-school feature. Enable it for every existing school so no student or
-- staff workflow changes on deploy. Schools created later start with no
-- feature enabled; "notices" gets no rows (off everywhere).
INSERT INTO "school_feature_flag" ("school_id", "feature", "enabled", "config", "updated_by")
SELECT "id", 'cadet', true, NULL, NULL FROM "school"
ON CONFLICT DO NOTHING;
