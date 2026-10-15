CREATE TYPE "public"."exam_plan_status" AS ENUM('draft', 'approved', 'active', 'completed');--> statement-breakpoint
CREATE TABLE "exam_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exam_slug" text NOT NULL,
	"class_id" text NOT NULL,
	"subject_slug" text NOT NULL,
	"total_marks" integer NOT NULL,
	"mode_config" jsonb NOT NULL,
	"total_working_days" integer,
	"status" "exam_plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "exam_plan_unique" UNIQUE("session_id","exam_slug","class_id","subject_slug")
);
--> statement-breakpoint
CREATE TABLE "exam_result" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_plan_id" text NOT NULL,
	"student_id" text NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"marks" jsonb NOT NULL,
	"co_scholastics" jsonb,
	"days_attended" integer,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "exam_result_unique" UNIQUE("exam_plan_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "exam_timetable" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exam_slug" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "exam_timetable_unique" UNIQUE("session_id","exam_slug")
);
--> statement-breakpoint
ALTER TABLE "exam_plan" ADD CONSTRAINT "exam_plan_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_plan" ADD CONSTRAINT "exam_plan_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_plan" ADD CONSTRAINT "exam_plan_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_exam_plan_id_exam_plan_id_fk" FOREIGN KEY ("exam_plan_id") REFERENCES "public"."exam_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_timetable" ADD CONSTRAINT "exam_timetable_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_timetable" ADD CONSTRAINT "exam_timetable_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;