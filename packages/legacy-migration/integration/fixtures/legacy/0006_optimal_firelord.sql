CREATE TABLE "exam_timetable" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"examSlug" varchar NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "exam_timetable_unique" UNIQUE("session_id","examSlug")
);
--> statement-breakpoint
ALTER TABLE "exam_timetable" ADD CONSTRAINT "exam_timetable_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_timetable" ADD CONSTRAINT "exam_timetable_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;