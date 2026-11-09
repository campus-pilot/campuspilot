CREATE TYPE "public"."notification_batch_kind" AS ENUM('billing_run', 'result_publication');--> statement-breakpoint
CREATE TYPE "public"."notification_send_priority" AS ENUM('immediate', 'bulk');--> statement-breakpoint
-- Existing rows get a priority through a temporary default; new rows always state one.
ALTER TABLE "notification_delivery" ADD COLUMN "send_priority" "notification_send_priority" DEFAULT 'immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "send_lane" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "quick_retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "deferred_retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "daily_limit_retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_event" ADD COLUMN "send_priority" "notification_send_priority" DEFAULT 'immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_event" ADD COLUMN "batch_kind" "notification_batch_kind";--> statement-breakpoint
ALTER TABLE "notification_event" ADD COLUMN "batch_id" text;--> statement-breakpoint
-- Events written before batches were recorded: billing-run bills carry their run in the facts,
-- publication copies their publication in the event key (`exam-results:<publicationId>:<admissionId>`).
UPDATE "notification_event" SET "batch_kind" = 'billing_run', "batch_id" = "data"->>'billRunId', "send_priority" = 'bulk'
  WHERE "type" = 'bill.issued' AND "data" ? 'billRunId';--> statement-breakpoint
UPDATE "notification_event" SET "batch_kind" = 'result_publication', "batch_id" = split_part("key", ':', 2), "send_priority" = 'bulk'
  WHERE "type" = 'exam.results_published' AND "key" LIKE 'exam-results:%:%';--> statement-breakpoint
UPDATE "notification_delivery" AS d SET "send_priority" = e."send_priority"
  FROM "notification" AS n JOIN "notification_event" AS e ON e."id" = n."event_id"
  WHERE n."id" = d."notification_id" AND e."send_priority" <> d."send_priority";--> statement-breakpoint
-- Copies owed before the send queue existed are due now.
UPDATE "notification_delivery" SET "next_attempt_at" = now() WHERE "status" = 'owed';--> statement-breakpoint
ALTER TABLE "notification_delivery" ALTER COLUMN "send_priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notification_event" ALTER COLUMN "send_priority" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "notification_delivery_queue_idx" ON "notification_delivery" USING btree ("channel","send_lane","next_attempt_at") WHERE "notification_delivery"."status" = 'owed';--> statement-breakpoint
CREATE INDEX "notification_event_batch_idx" ON "notification_event" USING btree ("school_id","batch_kind","batch_id") WHERE "notification_event"."batch_kind" is not null;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_next_attempt_check" CHECK (("notification_delivery"."status" = 'owed') = ("notification_delivery"."next_attempt_at" is not null));--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_batch_check" CHECK (("notification_event"."batch_kind" is null) = ("notification_event"."batch_id" is null));
