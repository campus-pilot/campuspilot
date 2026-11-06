-- Fail fast instead of queueing behind long transactions (demo tables only).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "demo_school_purge" RENAME COLUMN "cleanup_attempt" TO "attempt";--> statement-breakpoint
ALTER TABLE "demo_school_purge" ALTER COLUMN "object_keys" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ALTER COLUMN "demo_user_ids" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD COLUMN "start_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD COLUMN "submit_invocation_id" text;--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD COLUMN "submit_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD COLUMN "last_submit_error" text;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "school_name" text;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "school_slug" text;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "data_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "last_submit_error" text;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "submit_invocation_id" text;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "invocation_id" text;--> statement-breakpoint
-- Rows written before 0028 were created inside the data purge transaction,
-- so their data was deleted when they were written.
UPDATE "demo_school_purge" SET "data_deleted_at" = "created_at" WHERE "data_deleted_at" IS NULL;