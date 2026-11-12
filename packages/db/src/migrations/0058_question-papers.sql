CREATE TYPE "public"."question_paper_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."question_paper_page_derivative_status" AS ENUM('ready', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."question_paper_version_source" AS ENUM('ai_job', 'agent');--> statement-breakpoint
CREATE TABLE "exam_question_paper_figure" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"school_id" text NOT NULL,
	"s3_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"source_attachment_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_question_paper_figure_s3_key_unique" UNIQUE("s3_key"),
	CONSTRAINT "exam_question_paper_figure_content_type_check" CHECK ("exam_question_paper_figure"."content_type" in ('image/jpeg', 'image/png'))
);
--> statement-breakpoint
CREATE TABLE "exam_question_paper_job" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"school_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" "question_paper_job_status" DEFAULT 'queued' NOT NULL,
	"page_ids" jsonb NOT NULL,
	"page_revision" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"provider" "assistant_model_provider",
	"model" text,
	"model_request_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"error_detail" text,
	"version_id" text,
	"handed_over_at" timestamp with time zone,
	"handover_attempts" integer DEFAULT 0 NOT NULL,
	"last_handover_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "exam_question_paper_job_facts_check" CHECK (("exam_question_paper_job"."status" in ('succeeded', 'failed')) = ("exam_question_paper_job"."completed_at" is not null)
        and ("exam_question_paper_job"."status" = 'failed') = ("exam_question_paper_job"."error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "exam_question_paper_page" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"school_id" text NOT NULL,
	"position" integer NOT NULL,
	"original_s3_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"derivative_status" "question_paper_page_derivative_status" NOT NULL,
	"thumb_s3_key" text,
	"model_s3_key" text,
	"model_content_type" text,
	"model_byte_size" integer,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_question_paper_page_original_s3_key_unique" UNIQUE("original_s3_key"),
	CONSTRAINT "exam_question_paper_page_derivative_check" CHECK (("exam_question_paper_page"."derivative_status" = 'ready') = ("exam_question_paper_page"."thumb_s3_key" is not null and "exam_question_paper_page"."model_s3_key" is not null)),
	CONSTRAINT "exam_question_paper_page_size_check" CHECK ("exam_question_paper_page"."byte_size" between 1 and 15728640 and "exam_question_paper_page"."position" >= 1),
	CONSTRAINT "exam_question_paper_page_content_type_check" CHECK ("exam_question_paper_page"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'))
);
--> statement-breakpoint
CREATE TABLE "exam_question_paper" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"exam_slug" text NOT NULL,
	"class_id" text NOT NULL,
	"subject_slug" text NOT NULL,
	"mode_slug" text NOT NULL,
	"latest_version_no" integer DEFAULT 0 NOT NULL,
	"page_revision" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_question_paper_unique" UNIQUE("session_id","exam_slug","class_id","subject_slug","mode_slug"),
	CONSTRAINT "exam_question_paper_counters_check" CHECK ("exam_question_paper"."latest_version_no" >= 0 and "exam_question_paper"."page_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exam_question_paper_version" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"school_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"schema_version" integer NOT NULL,
	"source" "question_paper_version_source" NOT NULL,
	"source_job_id" text,
	"source_page_ids" jsonb,
	"source_conversation_id" text,
	"total_marks" numeric(8, 2),
	"plan_max_marks" integer,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template_revision_id" text NOT NULL,
	"pdf_artifact_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_question_paper_version_source_job_id_unique" UNIQUE("source_job_id"),
	CONSTRAINT "exam_question_paper_version_unique" UNIQUE("paper_id","version_no"),
	CONSTRAINT "exam_question_paper_version_no_check" CHECK ("exam_question_paper_version"."version_no" >= 1)
);
--> statement-breakpoint
ALTER TABLE "exam_question_paper_figure" ADD CONSTRAINT "exam_question_paper_figure_paper_id_exam_question_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_question_paper"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_figure" ADD CONSTRAINT "exam_question_paper_figure_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_job" ADD CONSTRAINT "exam_question_paper_job_paper_id_exam_question_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_question_paper"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_job" ADD CONSTRAINT "exam_question_paper_job_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_job" ADD CONSTRAINT "exam_question_paper_job_version_id_exam_question_paper_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."exam_question_paper_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD CONSTRAINT "exam_question_paper_page_paper_id_exam_question_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_question_paper"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD CONSTRAINT "exam_question_paper_page_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD CONSTRAINT "exam_question_paper_page_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_paper_id_exam_question_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_question_paper"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_source_job_id_exam_question_paper_job_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."exam_question_paper_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_template_revision_id_artifact_id_fk" FOREIGN KEY ("template_revision_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_pdf_artifact_id_artifact_id_fk" FOREIGN KEY ("pdf_artifact_id") REFERENCES "public"."artifact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_question_paper_figure_paper_idx" ON "exam_question_paper_figure" USING btree ("paper_id");--> statement-breakpoint
CREATE INDEX "exam_question_paper_figure_school_idx" ON "exam_question_paper_figure" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_question_paper_job_active_unique" ON "exam_question_paper_job" USING btree ("paper_id") WHERE "exam_question_paper_job"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "exam_question_paper_job_paper_idx" ON "exam_question_paper_job" USING btree ("paper_id","created_at");--> statement-breakpoint
CREATE INDEX "exam_question_paper_job_school_idx" ON "exam_question_paper_job" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exam_question_paper_job_version_idx" ON "exam_question_paper_job" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "exam_question_paper_job_unsent_idx" ON "exam_question_paper_job" USING btree ("created_at") WHERE "exam_question_paper_job"."handed_over_at" is null and "exam_question_paper_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "exam_question_paper_job_unstarted_idx" ON "exam_question_paper_job" USING btree ("handed_over_at") WHERE "exam_question_paper_job"."started_at" is null and "exam_question_paper_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "exam_question_paper_job_running_idx" ON "exam_question_paper_job" USING btree ("started_at") WHERE "exam_question_paper_job"."status" = 'running';--> statement-breakpoint
CREATE INDEX "exam_question_paper_page_order_idx" ON "exam_question_paper_page" USING btree ("paper_id","position");--> statement-breakpoint
CREATE INDEX "exam_question_paper_page_school_idx" ON "exam_question_paper_page" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exam_question_paper_page_uploaded_by_idx" ON "exam_question_paper_page" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "exam_question_paper_grid_idx" ON "exam_question_paper" USING btree ("school_id","session_id","exam_slug","class_id");--> statement-breakpoint
CREATE INDEX "exam_question_paper_class_idx" ON "exam_question_paper" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "exam_question_paper_created_by_idx" ON "exam_question_paper" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "exam_question_paper_version_order_idx" ON "exam_question_paper_version" USING btree ("paper_id","version_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exam_question_paper_version_school_idx" ON "exam_question_paper_version" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exam_question_paper_version_template_idx" ON "exam_question_paper_version" USING btree ("template_revision_id");--> statement-breakpoint
CREATE INDEX "exam_question_paper_version_pdf_idx" ON "exam_question_paper_version" USING btree ("pdf_artifact_id");