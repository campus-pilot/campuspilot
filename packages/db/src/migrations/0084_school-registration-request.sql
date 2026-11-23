CREATE TYPE "public"."school_setup_status" AS ENUM('draft', 'queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alert_status" "lead_alert_status" DEFAULT 'pending' NOT NULL,
	"alert_handed_over_at" timestamp with time zone,
	"alert_handover_attempts" integer DEFAULT 0 NOT NULL,
	"alert_last_handover_error" text,
	"alert_sent_at" timestamp with time zone,
	"alert_message_id" text,
	"alert_error" text
);
--> statement-breakpoint
CREATE TABLE "school_setup" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"draft" jsonb NOT NULL,
	"draft_step" text NOT NULL,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_updated_by" text,
	"status" "school_setup_status" DEFAULT 'draft' NOT NULL,
	"requested_by" text,
	"school_id" text,
	"current_step" text,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"attempt" integer DEFAULT 1 NOT NULL,
	"start_requested_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"submit_invocation_id" text,
	"submit_attempts" integer DEFAULT 0 NOT NULL,
	"last_submit_error" text,
	"invocation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "school_setup" ADD CONSTRAINT "school_setup_request_id_school_registration_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."school_registration_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_setup" ADD CONSTRAINT "school_setup_draft_updated_by_user_id_fk" FOREIGN KEY ("draft_updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_setup" ADD CONSTRAINT "school_setup_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_setup" ADD CONSTRAINT "school_setup_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "school_registration_request_submission_id_unique" ON "school_registration_request" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "school_registration_request_created_at_idx" ON "school_registration_request" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "school_registration_request_alert_unsent_idx" ON "school_registration_request" USING btree ("created_at") WHERE "school_registration_request"."alert_status" = 'pending' and "school_registration_request"."alert_handed_over_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "school_setup_request_unique" ON "school_setup" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_setup_school_unique" ON "school_setup" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "school_setup_status_idx" ON "school_setup" USING btree ("status","submitted_at");