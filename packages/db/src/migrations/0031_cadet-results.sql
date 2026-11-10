-- Adds the Cadet Portal release fact, teacher remarks and the class-average
-- setting. ALTER TABLE on "school" and "exam_lifecycle" takes a brief
-- exclusive lock; fail fast instead of queueing behind long transactions.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "exam_student_remark" (
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exam_slug" text NOT NULL,
	"student_id" text NOT NULL,
	"text" text NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_student_remark_session_id_exam_slug_student_id_pk" PRIMARY KEY("session_id","exam_slug","student_id"),
	CONSTRAINT "exam_student_remark_text_length_check" CHECK (char_length("exam_student_remark"."text") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "exam_lifecycle" ADD COLUMN "cadet_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_lifecycle" ADD COLUMN "cadet_released_by" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "cadet_show_class_averages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_student_remark" ADD CONSTRAINT "exam_student_remark_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_student_remark" ADD CONSTRAINT "exam_student_remark_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_student_remark" ADD CONSTRAINT "exam_student_remark_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_student_remark" ADD CONSTRAINT "exam_student_remark_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_student_remark_school_student_idx" ON "exam_student_remark" USING btree ("school_id","student_id");--> statement-breakpoint
ALTER TABLE "exam_lifecycle" ADD CONSTRAINT "exam_lifecycle_cadet_released_by_user_id_fk" FOREIGN KEY ("cadet_released_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;