-- Batched, durable document generation (docs/document-system.md "Generation
-- jobs"). "document_generation_job" is both the job a PDF export runs as in
-- the worker and the outbox the API sweep re-sends to Restate. At most one job
-- of a school runs at a time (a partial unique index backs Restate's
-- per-school queue). The PDF's artifact id is reserved on the job, so a
-- repeated finish can never create a second artifact.
CREATE TYPE "public"."document_generation_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "document_generation_job" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"requested_by" text NOT NULL,
	"status" "document_generation_job_status" DEFAULT 'queued' NOT NULL,
	"source" jsonb NOT NULL,
	"template_revision_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"name" text NOT NULL,
	"document_count" integer NOT NULL,
	"printed_document_count" integer,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"review_hash" text,
	"ledger_cutoff" jsonb,
	"batch_count" integer,
	"batches_done" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"error_detail" text,
	"handed_over_at" timestamp with time zone,
	"handover_attempts" integer DEFAULT 0 NOT NULL,
	"last_handover_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"temporary_objects_deleted_at" timestamp with time zone,
	CONSTRAINT "document_generation_job_artifact_id_unique" UNIQUE("artifact_id"),
	CONSTRAINT "document_generation_job_facts_check" CHECK (("document_generation_job"."status" in ('succeeded', 'failed')) = ("document_generation_job"."completed_at" is not null)
        and ("document_generation_job"."status" = 'failed') = ("document_generation_job"."error_code" is not null)
        and ("document_generation_job"."status" <> 'queued' or "document_generation_job"."started_at" is null)
        and ("document_generation_job"."status" not in ('running', 'succeeded') or "document_generation_job"."started_at" is not null)),
	CONSTRAINT "document_generation_job_progress_check" CHECK ("document_generation_job"."batches_done" >= 0 and ("document_generation_job"."batch_count" is null or ("document_generation_job"."batch_count" >= 1 and "document_generation_job"."batches_done" <= "document_generation_job"."batch_count"))),
	CONSTRAINT "document_generation_job_documents_check" CHECK ("document_generation_job"."document_count" >= 1 and ("document_generation_job"."printed_document_count" is null or "document_generation_job"."printed_document_count" >= 1))
);
--> statement-breakpoint
ALTER TABLE "document_generation_job" ADD CONSTRAINT "document_generation_job_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_generation_job" ADD CONSTRAINT "document_generation_job_template_revision_id_artifact_id_fk" FOREIGN KEY ("template_revision_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_generation_job_school_session_idx" ON "document_generation_job" USING btree ("school_id","session_id","created_at");--> statement-breakpoint
CREATE INDEX "document_generation_job_template_idx" ON "document_generation_job" USING btree ("template_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_generation_job_running_school_unique" ON "document_generation_job" USING btree ("school_id") WHERE "document_generation_job"."status" = 'running';--> statement-breakpoint
CREATE INDEX "document_generation_job_unsent_idx" ON "document_generation_job" USING btree ("created_at") WHERE "document_generation_job"."handed_over_at" is null and "document_generation_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "document_generation_job_unstarted_idx" ON "document_generation_job" USING btree ("handed_over_at") WHERE "document_generation_job"."started_at" is null and "document_generation_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "document_generation_job_running_idx" ON "document_generation_job" USING btree ("started_at") WHERE "document_generation_job"."status" = 'running';--> statement-breakpoint
CREATE INDEX "document_generation_job_cleanup_idx" ON "document_generation_job" USING btree ("completed_at") WHERE "document_generation_job"."temporary_objects_deleted_at" is null and "document_generation_job"."status" in ('succeeded', 'failed');--> statement-breakpoint
-- Re-creates purge_demo_school from 0076 unchanged except for document
-- generation jobs: "document_generation_job" rows are deleted before the
-- artifacts (their pinned template revisions) they reference.
CREATE OR REPLACE FUNCTION "public"."purge_demo_school"(target_school_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
	demo boolean;
	counts jsonb := '{}'::jsonb;
	affected bigint;
BEGIN
	SELECT "is_demo" INTO demo FROM "public"."school" WHERE "id" = target_school_id FOR UPDATE;
	IF NOT FOUND THEN RAISE EXCEPTION 'School % does not exist', target_school_id; END IF;
	IF NOT demo THEN RAISE EXCEPTION 'Only demo schools can be purged'; END IF;
	-- Binds the finance delete exception to this call (removed before returning).
	INSERT INTO "public"."demo_purge_marker" ("transaction_id", "school_id") VALUES (pg_catalog.txid_current(), target_school_id);

	-- In-app assistant: children before their runs and conversations, the
	-- saved costs with them, and the school's role list.
	DELETE FROM "public"."assistant_model_request" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('assistant_model_request', affected);
	DELETE FROM "public"."assistant_approval" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('assistant_approval', affected);
	DELETE FROM "public"."assistant_transcript_entry" WHERE "conversation_id" IN (SELECT "id" FROM "public"."assistant_conversation" WHERE "school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('assistant_transcript_entry', affected);
	DELETE FROM "public"."assistant_attachment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('assistant_attachment', affected);
	DELETE FROM "public"."assistant_item" WHERE "conversation_id" IN (SELECT "id" FROM "public"."assistant_conversation" WHERE "school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('assistant_item', affected);
	DELETE FROM "public"."assistant_run" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('assistant_run', affected);
	DELETE FROM "public"."assistant_conversation" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('assistant_conversation', affected);
	DELETE FROM "public"."school_assistant_access_role" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_assistant_access_role', affected);

	-- Question papers: children before the paper, and the versions before the
	-- artifacts (template revision, PDF) and classes they reference.
	DELETE FROM "public"."exam_question_paper_figure" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_question_paper_figure', affected);
	DELETE FROM "public"."exam_question_paper_job" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_question_paper_job', affected);
	DELETE FROM "public"."exam_question_paper_page" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_question_paper_page', affected);
	DELETE FROM "public"."exam_question_paper_version" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_question_paper_version', affected);
	DELETE FROM "public"."exam_question_paper" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_question_paper', affected);

	-- Notifications: deliveries and inbox rows before their events, and all
	-- three before the admissions and users they reference.
	DELETE FROM "public"."notification_delivery" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('notification_delivery', affected);
	DELETE FROM "public"."notification" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('notification', affected);
	DELETE FROM "public"."notification_event" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('notification_event', affected);

	DELETE FROM "public"."finance_payment_allocation" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_payment_allocation', affected);
	DELETE FROM "public"."finance_refund" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_refund', affected);
	DELETE FROM "public"."finance_adjustment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_adjustment', affected);
	DELETE FROM "public"."finance_payment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_payment', affected);
	DELETE FROM "public"."finance_bill_line" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_bill_line', affected);
	DELETE FROM "public"."finance_bill" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_bill', affected);
	DELETE FROM "public"."finance_ledger_entry" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_ledger_entry', affected);
	DELETE FROM "public"."finance_bill_run" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_bill_run', affected);
	DELETE FROM "public"."finance_admission_balance" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_admission_balance', affected);
	DELETE FROM "public"."finance_admission_session_activity" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_admission_session_activity', affected);
	DELETE FROM "public"."finance_number_counter" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_number_counter', affected);

	DELETE FROM "public"."exam_result_publication" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_result_publication', affected);
	DELETE FROM "public"."exam_student_remark" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_student_remark', affected);
	DELETE FROM "public"."exam_result" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_result', affected);
	DELETE FROM "public"."exam_student_assessment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_student_assessment', affected);
	DELETE FROM "public"."exam_assessment_settings" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_assessment_settings', affected);
	DELETE FROM "public"."exam_timetable" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_timetable', affected);
	DELETE FROM "public"."exam_plan" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_plan', affected);
	-- Class participation after the plans that reference it (0076).
	DELETE FROM "public"."exam_class" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_class', affected);
	DELETE FROM "public"."exam_lifecycle" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_lifecycle', affected);

	-- Notices: the class rows before the notices, and both before the
	-- artifacts (pinned template revisions), classes, sessions and users they
	-- reference. Their cached PDFs live under the school's S3 prefix, which
	-- the purge workflow sweeps.
	DELETE FROM "public"."notice_class" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('notice_class', affected);
	DELETE FROM "public"."notice" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('notice', affected);

	-- Document generation jobs (0084) before the artifacts their pinned
	-- template revisions are. Their temporary objects live under the
	-- school's S3 prefix (schools/{id}/document-jobs/), which the purge
	-- workflow sweeps.
	DELETE FROM "public"."document_generation_job" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('document_generation_job', affected);

	DELETE FROM "public"."school_document_template" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_document_template', affected);
	DELETE FROM "public"."artifact" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('artifact', affected);
	DELETE FROM "public"."student" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('student', affected);
	-- Cadet Portal logins of the school's admissions and everything they own.
	-- They would cascade with "admission" too; deleting them explicitly keeps
	-- the counts and makes the cleanup independent of the cascade. Sessions
	-- were already revoked through the cadet auth instance (Redis included)
	-- by the workflow's revoke stage.
	-- Web push subscriptions of those logins (they would cascade with
	-- "cadet_user" too; explicit for the counts).
	DELETE FROM "public"."cadet_push_subscription" WHERE "cadet_user_id" IN (SELECT cu."id" FROM "public"."cadet_user" cu JOIN "public"."admission" a ON a."id" = cu."admission_id" WHERE a."school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('cadet_push_subscription', affected);
	DELETE FROM "public"."cadet_oauth_access_token" WHERE "user_id" IN (SELECT cu."id" FROM "public"."cadet_user" cu JOIN "public"."admission" a ON a."id" = cu."admission_id" WHERE a."school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('cadet_oauth_access_token', affected);
	DELETE FROM "public"."cadet_oauth_refresh_token" WHERE "user_id" IN (SELECT cu."id" FROM "public"."cadet_user" cu JOIN "public"."admission" a ON a."id" = cu."admission_id" WHERE a."school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('cadet_oauth_refresh_token', affected);
	DELETE FROM "public"."cadet_oauth_consent" WHERE "user_id" IN (SELECT cu."id" FROM "public"."cadet_user" cu JOIN "public"."admission" a ON a."id" = cu."admission_id" WHERE a."school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('cadet_oauth_consent', affected);
	DELETE FROM "public"."cadet_oauth_client" WHERE "user_id" IN (SELECT cu."id" FROM "public"."cadet_user" cu JOIN "public"."admission" a ON a."id" = cu."admission_id" WHERE a."school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('cadet_oauth_client', affected);
	DELETE FROM "public"."cadet_session" WHERE "user_id" IN (SELECT cu."id" FROM "public"."cadet_user" cu JOIN "public"."admission" a ON a."id" = cu."admission_id" WHERE a."school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('cadet_session', affected);
	DELETE FROM "public"."cadet_account" WHERE "user_id" IN (SELECT cu."id" FROM "public"."cadet_user" cu JOIN "public"."admission" a ON a."id" = cu."admission_id" WHERE a."school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('cadet_account', affected);
	DELETE FROM "public"."cadet_user" WHERE "admission_id" IN (SELECT "id" FROM "public"."admission" WHERE "school_id" = target_school_id); GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('cadet_user', affected);
	DELETE FROM "public"."admission" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('admission', affected);
	DELETE FROM "public"."section" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('section', affected);
	DELETE FROM "public"."class" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('class', affected);
	DELETE FROM "public"."school_session" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_session', affected);
	DELETE FROM "public"."demo_school_job" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('demo_school_job', affected);

	-- Demo-only accounts. Sessions, credential accounts and OAuth grants cascade
	-- from "user"; API keys reference their owner without a foreign key. The
	-- requesting admin has no demo_school_id and only loses the memberships.
	DELETE FROM "public"."apikey" WHERE "reference_id" IN (SELECT "id" FROM "public"."user" WHERE "demo_school_id" = target_school_id);
	DELETE FROM "public"."user" WHERE "demo_school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('user', affected);
	-- Platform feature flags of the school (no cascade from "school").
	DELETE FROM "public"."school_feature_flag" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_feature_flag', affected);
	DELETE FROM "public"."school_user_role" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_user_role', affected);
	DELETE FROM "public"."school_member" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_member', affected);
	DELETE FROM "public"."school" WHERE "id" = target_school_id;
	DELETE FROM "public"."demo_purge_marker" WHERE "transaction_id" = pg_catalog.txid_current();
	RETURN counts;
END; $$;--> statement-breakpoint
COMMENT ON FUNCTION "public"."purge_demo_school"(text) IS 'Deletes a demo school (is_demo = true) and everything it owns, including demo-only users, the Cadet Portal logins of its admissions (with their push subscriptions), teacher remarks on its examinations, its notifications, its exam result publications, its examination class participation, its feature flags, its notices, its question papers, its document generation jobs and its in-app assistant data (conversations, runs, saved costs and its assistant role list). Refuses real schools. S3 objects are removed separately by the DemoSchoolPurge workflow from demo_school_purge.';
