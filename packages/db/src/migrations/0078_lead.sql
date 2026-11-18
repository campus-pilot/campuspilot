CREATE TYPE "public"."lead_alert_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "lead" (
	"id" text PRIMARY KEY NOT NULL,
	"form" text NOT NULL,
	"form_version" integer NOT NULL,
	"submission_id" text NOT NULL,
	"response" jsonb NOT NULL,
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
CREATE UNIQUE INDEX "lead_submission_id_unique" ON "lead" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "lead_created_at_idx" ON "lead" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lead_alert_unsent_idx" ON "lead" USING btree ("created_at") WHERE "lead"."alert_status" = 'pending' and "lead"."alert_handed_over_at" is null;