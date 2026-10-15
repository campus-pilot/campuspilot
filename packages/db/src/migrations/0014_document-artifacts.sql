CREATE TYPE "public"."artifact_kind" AS ENUM('template', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."artifact_status" AS ENUM('ready', 'deleting');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('report_card', 'id_card', 'admit_card', 'timetable');--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"document_type" "document_type" NOT NULL,
	"status" "artifact_status" DEFAULT 'ready' NOT NULL,
	"name" text NOT NULL,
	"s3_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"template_revision_id" text,
	"marketplace_slug" text,
	"session_id" text,
	"exam_slug" text,
	"class_id" text,
	"student_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"student_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_s3_key_unique" UNIQUE("s3_key")
);
--> statement-breakpoint
CREATE TABLE "school_document_template" (
	"school_id" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"artifact_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_document_template_unique" UNIQUE("school_id","document_type")
);
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_document_template" ADD CONSTRAINT "school_document_template_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_document_template" ADD CONSTRAINT "school_document_template_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_school_created_idx" ON "artifact" USING btree ("school_id","created_at","id");--> statement-breakpoint
CREATE INDEX "artifact_template_revision_idx" ON "artifact" USING btree ("template_revision_id");