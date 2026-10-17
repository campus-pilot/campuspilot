CREATE TABLE "exam_assessment_settings" (
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exam_slug" text NOT NULL,
	"total_working_days" integer,
	CONSTRAINT "exam_assessment_settings_session_id_exam_slug_pk" PRIMARY KEY("session_id","exam_slug")
);
--> statement-breakpoint
CREATE TABLE "exam_student_assessment" (
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exam_slug" text NOT NULL,
	"student_id" text NOT NULL,
	"days_attended" integer,
	"co_scholastics" jsonb,
	"approved" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exam_student_assessment_session_id_exam_slug_student_id_pk" PRIMARY KEY("session_id","exam_slug","student_id")
);
--> statement-breakpoint
ALTER TABLE "exam_assessment_settings" ADD CONSTRAINT "exam_assessment_settings_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_assessment_settings" ADD CONSTRAINT "exam_assessment_settings_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_student_assessment" ADD CONSTRAINT "exam_student_assessment_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_student_assessment" ADD CONSTRAINT "exam_student_assessment_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_student_assessment" ADD CONSTRAINT "exam_student_assessment_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;