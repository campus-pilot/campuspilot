ALTER TABLE "notification_event" ADD COLUMN "dispatch_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_event" ADD COLUMN "failure_retryable" boolean;--> statement-breakpoint
-- Events that failed before automatic retries existed are not retried.
UPDATE "notification_event" SET "failure_retryable" = false WHERE "status" = 'failed';--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_failure_retryable_check" CHECK (("notification_event"."status" = 'failed') = ("notification_event"."failure_retryable" is not null));