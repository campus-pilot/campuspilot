CREATE TYPE "public"."assistant_model_request_source" AS ENUM('chat', 'question_paper');--> statement-breakpoint
ALTER TABLE "assistant_model_request" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_model_request" ADD COLUMN "source" "assistant_model_request_source" NOT NULL DEFAULT 'chat';--> statement-breakpoint
ALTER TABLE "assistant_model_request" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "assistant_model_request" ADD COLUMN "question_paper_job_id" text;--> statement-breakpoint
CREATE INDEX "assistant_model_request_school_source_created_idx" ON "assistant_model_request" USING btree ("school_id","source","created_at");--> statement-breakpoint
ALTER TABLE "assistant_model_request" ADD CONSTRAINT "assistant_model_request_source_owner_check" CHECK (("assistant_model_request"."source" = 'chat' and "assistant_model_request"."run_id" is not null and "assistant_model_request"."question_paper_job_id" is null)
        or ("assistant_model_request"."source" = 'question_paper' and "assistant_model_request"."run_id" is null and "assistant_model_request"."question_paper_job_id" is not null));