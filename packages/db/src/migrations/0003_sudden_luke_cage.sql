CREATE TABLE "school_session" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_end_year" integer NOT NULL,
	"session_start_year" integer NOT NULL,
	"session_config" jsonb,
	"finance_config" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "school_session" ADD CONSTRAINT "school_session_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;