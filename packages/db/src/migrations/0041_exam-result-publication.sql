CREATE TABLE "exam_result_publication" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exam_slug" text NOT NULL,
	"exam_name" text NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admission_ids" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" jsonb,
	CONSTRAINT "exam_result_publication_outcome_check" CHECK (("exam_result_publication"."finished_at" is null) = ("exam_result_publication"."outcome" is null)),
	CONSTRAINT "exam_result_publication_recipients_check" CHECK (jsonb_typeof("exam_result_publication"."admission_ids") = 'array' and jsonb_array_length("exam_result_publication"."admission_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "exam_result_publication" ADD CONSTRAINT "exam_result_publication_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result_publication" ADD CONSTRAINT "exam_result_publication_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result_publication" ADD CONSTRAINT "exam_result_publication_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_result_publication_exam_unique" ON "exam_result_publication" USING btree ("school_id","session_id","exam_slug");--> statement-breakpoint
CREATE INDEX "exam_result_publication_unfinished_idx" ON "exam_result_publication" USING btree ("published_at") WHERE "exam_result_publication"."finished_at" is null;