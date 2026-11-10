CREATE TYPE "public"."notice_body_mode" AS ENUM('plain', 'template');--> statement-breakpoint
CREATE TYPE "public"."notice_cadet_scope" AS ENUM('none', 'all_classes', 'selected_classes');--> statement-breakpoint
CREATE TYPE "public"."notice_status" AS ENUM('draft', 'published');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'notice';--> statement-breakpoint
ALTER TYPE "public"."notification_batch_kind" ADD VALUE IF NOT EXISTS 'notice';--> statement-breakpoint
ALTER TYPE "public"."notification_skip_reason" ADD VALUE IF NOT EXISTS 'feature_disabled';--> statement-breakpoint
CREATE TABLE "notice_class" (
	"id" text PRIMARY KEY NOT NULL,
	"notice_id" text NOT NULL,
	"class_id" text,
	"class_name" text NOT NULL,
	"school_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"title" text NOT NULL,
	"body_mode" "notice_body_mode" NOT NULL,
	"body" text NOT NULL,
	"status" "notice_status" DEFAULT 'draft' NOT NULL,
	"to_staff" boolean NOT NULL,
	"cadet_scope" "notice_cadet_scope" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"issued_on" date,
	"template_revision_id" text,
	"published_staff_count" integer,
	"published_cadet_count" integer,
	CONSTRAINT "notice_audience_check" CHECK ("notice"."to_staff" or "notice"."cadet_scope" <> 'none'),
	CONSTRAINT "notice_published_facts_check" CHECK (("notice"."status" = 'published') = ("notice"."published_at" is not null)
        and ("notice"."status" = 'published') = ("notice"."issued_on" is not null)
        and ("notice"."status" = 'published') = ("notice"."published_staff_count" is not null)
        and ("notice"."status" = 'published') = ("notice"."published_cadet_count" is not null)
        and ("notice"."status" = 'published' or "notice"."published_by" is null)),
	CONSTRAINT "notice_template_revision_check" CHECK ("notice"."template_revision_id" is null or ("notice"."status" = 'published' and "notice"."body_mode" = 'plain')),
	CONSTRAINT "notice_title_check" CHECK (char_length("notice"."title") between 1 and 200),
	CONSTRAINT "notice_version_check" CHECK ("notice"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "notice_class" ADD CONSTRAINT "notice_class_notice_id_notice_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_class" ADD CONSTRAINT "notice_class_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_class" ADD CONSTRAINT "notice_class_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_template_revision_id_artifact_id_fk" FOREIGN KEY ("template_revision_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notice_class_notice_class_unique" ON "notice_class" USING btree ("notice_id","class_id");--> statement-breakpoint
CREATE INDEX "notice_class_class_idx" ON "notice_class" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "notice_class_school_idx" ON "notice_class" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "notice_school_session_created_idx" ON "notice" USING btree ("school_id","session_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notice_school_session_published_idx" ON "notice" USING btree ("school_id","session_id","published_at","id") WHERE "notice"."status" = 'published';--> statement-breakpoint
CREATE INDEX "notice_created_by_idx" ON "notice" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "notice_published_by_idx" ON "notice" USING btree ("published_by");