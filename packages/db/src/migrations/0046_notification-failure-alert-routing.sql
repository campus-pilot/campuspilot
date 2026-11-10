ALTER TABLE "notification_event" ADD COLUMN "alert_creator_on_failure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Sends staff asked for before the flag existed: resends and single result sends (`exam-result:<digest>`).
UPDATE "notification_event" SET "alert_creator_on_failure" = true
  WHERE "created_by" IS NOT NULL AND ("redelivery_of_delivery_id" IS NOT NULL OR "key" LIKE 'exam-result:%');
