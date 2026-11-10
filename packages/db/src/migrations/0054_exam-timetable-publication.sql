ALTER TABLE "exam_timetable" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_timetable" ADD COLUMN "published_by" text;--> statement-breakpoint
ALTER TABLE "exam_timetable" ADD COLUMN "publication_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_timetable" ADD CONSTRAINT "exam_timetable_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_timetable" ADD CONSTRAINT "exam_timetable_publication_count_check" CHECK ("exam_timetable"."publication_count" >= 0 and ("exam_timetable"."published_at" is null or "exam_timetable"."publication_count" >= 1));