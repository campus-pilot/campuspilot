CREATE TABLE "school_registration_request" (
	"id" text PRIMARY KEY NOT NULL,
	"form_version" integer NOT NULL,
	"submission_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"logo_s3_key" text,
	"logo_content_type" text,
	"logo_bytes" integer,
	"voice_note_s3_key" text,
	"voice_note_content_type" text,
	"voice_note_bytes" integer,
	"source_path" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "school_registration_request_submission_id_unique" ON "school_registration_request" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "school_registration_request_created_at_idx" ON "school_registration_request" USING btree ("created_at");