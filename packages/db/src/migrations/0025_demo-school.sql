CREATE TYPE "public"."demo_school_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "demo_school_job" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"input" jsonb NOT NULL,
	"seed" text,
	"as_of" timestamp with time zone,
	"status" "demo_school_job_status" DEFAULT 'queued' NOT NULL,
	"current_step" text,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "demo_school_id" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "demo_created_by" text;--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD CONSTRAINT "demo_school_job_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD CONSTRAINT "demo_school_job_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_school_job_school_idx" ON "demo_school_job" USING btree ("school_id","created_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_demo_school_id_school_id_fk" FOREIGN KEY ("demo_school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_demo_created_by_user_id_fk" FOREIGN KEY ("demo_created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Demo-only exception to finance immutability (docs/demo-school.md, plan §9.2).
-- A finance fact may be deleted only inside purge_demo_school(): the
-- transaction-local setting must name the row's school AND that school must be
-- a demo school. Real schools keep append-only finance; every UPDATE rule is
-- unchanged. Any other delete, from any role, still raises.
CREATE OR REPLACE FUNCTION "finance_demo_purge_allows"(target_school_id text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
	RETURN target_school_id IS NOT NULL
		AND COALESCE(current_setting('campuspilot.demo_purge_school_id', true), '') = target_school_id
		AND EXISTS (SELECT 1 FROM "school" WHERE "id" = target_school_id AND "is_demo");
END; $$;--> statement-breakpoint
COMMENT ON FUNCTION "finance_demo_purge_allows"(text) IS 'True only inside purge_demo_school() for that demo school; the single place the demo-purge finance exception is decided.';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_reject_fact_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	-- Demo purge exception: see finance_demo_purge_allows(). UPDATE always raises.
	IF TG_OP = 'DELETE' AND "finance_demo_purge_allows"(OLD."school_id") THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'Finance facts are append-only; post a correction or reversal instead';
END; $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_guard_bill_finalization"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_count bigint; actual_total bigint;
BEGIN
	IF TG_OP = 'DELETE' THEN
		-- Demo purge exception: see finance_demo_purge_allows().
		IF OLD."status" = 'posted' AND NOT "finance_demo_purge_allows"(OLD."school_id") THEN RAISE EXCEPTION 'Posted bills are immutable'; END IF;
		RETURN OLD;
	END IF;
	IF OLD."status" <> 'posting' OR NEW."status" <> 'posted'
		OR NEW."finalized_at" IS NULL
		OR (to_jsonb(NEW) - 'status' - 'finalized_at') <> (to_jsonb(OLD) - 'status' - 'finalized_at') THEN
		RAISE EXCEPTION 'Only the posting-to-posted bill finalization transition is allowed';
	END IF;
	SELECT count(*), COALESCE(sum("amount_minor"), 0) INTO actual_count, actual_total FROM "finance_bill_line" WHERE "bill_id" = OLD."id";
	IF actual_count <> NEW."line_count" OR actual_total <> NEW."total_amount_minor" THEN
		RAISE EXCEPTION 'Bill header does not reconcile to its immutable lines';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_guard_run_finalization"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_count bigint; actual_total bigint; open_count bigint;
BEGIN
	IF TG_OP = 'DELETE' THEN
		-- Demo purge exception: see finance_demo_purge_allows().
		IF OLD."status" = 'posted' AND NOT "finance_demo_purge_allows"(OLD."school_id") THEN RAISE EXCEPTION 'Posted bill runs are immutable'; END IF;
		RETURN OLD;
	END IF;
	IF OLD."status" <> 'posting' OR NEW."status" <> 'posted'
		OR NEW."finalized_at" IS NULL
		OR (to_jsonb(NEW) - 'status' - 'finalized_at') <> (to_jsonb(OLD) - 'status' - 'finalized_at') THEN
		RAISE EXCEPTION 'Only the posting-to-posted run finalization transition is allowed';
	END IF;
	SELECT count(*), COALESCE(sum("total_amount_minor"), 0), count(*) FILTER (WHERE "status" <> 'posted')
	INTO actual_count, actual_total, open_count FROM "finance_bill" WHERE "bill_run_id" = OLD."id";
	IF open_count <> 0 OR actual_count <> NEW."bill_count" OR actual_total <> NEW."total_amount_minor" THEN
		RAISE EXCEPTION 'Bill run header does not reconcile to finalized member bills';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
-- Removes every row a demo school owns, including its demo-only user accounts
-- (user.demo_school_id), in foreign-key dependency order. SECURITY INVOKER: the
-- caller's own DELETE privileges apply; only the trigger exception above is new.
-- Any new school-owned table must be added here (AGENTS.md "Demo schools").
CREATE OR REPLACE FUNCTION "purge_demo_school"(target_school_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
	demo boolean;
	counts jsonb := '{}'::jsonb;
	affected bigint;
BEGIN
	SELECT "is_demo" INTO demo FROM "school" WHERE "id" = target_school_id FOR UPDATE;
	IF NOT FOUND THEN RAISE EXCEPTION 'School % does not exist', target_school_id; END IF;
	IF NOT demo THEN RAISE EXCEPTION 'Only demo schools can be purged'; END IF;
	PERFORM set_config('campuspilot.demo_purge_school_id', target_school_id, true);

	DELETE FROM "finance_payment_allocation" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_payment_allocation', affected);
	DELETE FROM "finance_refund" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_refund', affected);
	DELETE FROM "finance_adjustment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_adjustment', affected);
	DELETE FROM "finance_payment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_payment', affected);
	DELETE FROM "finance_bill_line" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_bill_line', affected);
	DELETE FROM "finance_bill" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_bill', affected);
	DELETE FROM "finance_ledger_entry" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_ledger_entry', affected);
	DELETE FROM "finance_bill_run" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_bill_run', affected);
	DELETE FROM "finance_admission_balance" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_admission_balance', affected);
	DELETE FROM "finance_admission_session_activity" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_admission_session_activity', affected);
	DELETE FROM "finance_number_counter" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('finance_number_counter', affected);

	DELETE FROM "exam_result" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_result', affected);
	DELETE FROM "exam_student_assessment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_student_assessment', affected);
	DELETE FROM "exam_assessment_settings" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_assessment_settings', affected);
	DELETE FROM "exam_timetable" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_timetable', affected);
	DELETE FROM "exam_plan" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_plan', affected);
	DELETE FROM "exam_lifecycle" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_lifecycle', affected);

	DELETE FROM "school_document_template" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_document_template', affected);
	DELETE FROM "artifact" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('artifact', affected);
	DELETE FROM "student" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('student', affected);
	DELETE FROM "admission" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('admission', affected);
	DELETE FROM "section" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('section', affected);
	DELETE FROM "class" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('class', affected);
	DELETE FROM "school_session" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_session', affected);
	DELETE FROM "demo_school_job" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('demo_school_job', affected);

	-- Demo-only accounts. Sessions, credential accounts and OAuth grants cascade
	-- from "user"; API keys reference their owner without a foreign key. The
	-- requesting admin has no demo_school_id and only loses the memberships.
	DELETE FROM "apikey" WHERE "reference_id" IN (SELECT "id" FROM "user" WHERE "demo_school_id" = target_school_id);
	DELETE FROM "user" WHERE "demo_school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('user', affected);
	DELETE FROM "school_user_role" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_user_role', affected);
	DELETE FROM "school_member" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_member', affected);
	DELETE FROM "school" WHERE "id" = target_school_id;
	RETURN counts;
END; $$;--> statement-breakpoint
COMMENT ON FUNCTION "purge_demo_school"(text) IS 'Deletes a demo school (is_demo = true) and everything it owns, including demo-only users. Refuses real schools. S3 objects are removed separately by the DemoSchoolPurge workflow.';
