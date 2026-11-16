CREATE TYPE "public"."question_paper_page_upload_status" AS ENUM('awaiting', 'stored');--> statement-breakpoint
ALTER TYPE "public"."assistant_attachment_derivative_status" ADD VALUE 'pending';--> statement-breakpoint
ALTER TYPE "public"."assistant_attachment_derivative_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TYPE "public"."question_paper_page_derivative_status" ADD VALUE 'pending';--> statement-breakpoint
ALTER TYPE "public"."question_paper_page_derivative_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" DROP CONSTRAINT "exam_question_paper_page_size_check";--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ALTER COLUMN "original_s3_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ALTER COLUMN "content_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ALTER COLUMN "byte_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ALTER COLUMN "sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD COLUMN "upload_status" "question_paper_page_upload_status" DEFAULT 'stored' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD COLUMN "stored_at" timestamp with time zone;--> statement-breakpoint
-- Every existing page was stored when it was created.
UPDATE "exam_question_paper_page" SET "stored_at" = "created_at";--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD CONSTRAINT "exam_question_paper_page_upload_check" CHECK (("exam_question_paper_page"."upload_status" = 'stored') = ("exam_question_paper_page"."original_s3_key" is not null and "exam_question_paper_page"."content_type" is not null and "exam_question_paper_page"."byte_size" is not null and "exam_question_paper_page"."sha256" is not null and "exam_question_paper_page"."stored_at" is not null) and ("exam_question_paper_page"."upload_status" = 'stored' or "exam_question_paper_page"."derivative_status"::text = 'pending'));--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD CONSTRAINT "exam_question_paper_page_size_check" CHECK ("exam_question_paper_page"."position" >= 1 and ("exam_question_paper_page"."byte_size" is null or "exam_question_paper_page"."byte_size" between 1 and 15728640));