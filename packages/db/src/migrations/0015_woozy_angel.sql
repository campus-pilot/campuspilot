CREATE TYPE "public"."exam_lifecycle_status" AS ENUM('ready', 'active', 'completed');--> statement-breakpoint
CREATE TABLE "exam_lifecycle" (
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exam_slug" text NOT NULL,
	"status" "exam_lifecycle_status" DEFAULT 'ready' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "exam_lifecycle_session_id_exam_slug_pk" PRIMARY KEY("session_id","exam_slug")
);
--> statement-breakpoint
ALTER TABLE "exam_lifecycle" ADD CONSTRAINT "exam_lifecycle_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_lifecycle" ADD CONSTRAINT "exam_lifecycle_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO exam_lifecycle (school_id, session_id, exam_slug, status)
SELECT school_id, session_id, exam_slug,
  CASE WHEN bool_and(status = 'completed') THEN 'completed'::exam_lifecycle_status
       WHEN bool_or(status = 'active') THEN 'active'::exam_lifecycle_status
       ELSE 'ready'::exam_lifecycle_status END
FROM exam_plan GROUP BY school_id, session_id, exam_slug;
