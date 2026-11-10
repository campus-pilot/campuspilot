CREATE TYPE "public"."demo_school_purge_status" AS ENUM('pending', 'scheduled', 'completed');--> statement-breakpoint
CREATE TABLE "demo_purge_marker" (
	"transaction_id" bigint PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_school_purge" (
	"school_id" text PRIMARY KEY NOT NULL,
	"object_keys" jsonb NOT NULL,
	"demo_user_ids" jsonb NOT NULL,
	"status" "demo_school_purge_status" DEFAULT 'pending' NOT NULL,
	"submit_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "demo_school_job" DROP CONSTRAINT "demo_school_job_requested_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "demo_school_job" ALTER COLUMN "requested_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD CONSTRAINT "demo_school_job_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hardening of the demo-purge finance exception (review 1, L1/L2).
-- L1: every function pins search_path and calls schema-qualified objects, so
--     a schema earlier on a caller's search_path cannot shadow the helper.
-- L2: the exception is bound to purge_demo_school() itself instead of a
--     placeholder setting anyone could SET: the function inserts a marker row
--     for the current transaction and removes it before returning, and the
--     helper also requires purge_demo_school(text) on the PL/pgSQL call stack.
--     A role that owns these tables could still disable the triggers; that
--     was true before the exception and is outside what triggers can prevent.
REVOKE ALL ON TABLE "demo_purge_marker" FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."finance_demo_purge_allows"(target_school_id text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE call_stack text;
BEGIN
	IF target_school_id IS NULL THEN RETURN false; END IF;
	IF NOT EXISTS (
		SELECT 1 FROM "public"."demo_purge_marker" AS marker
		WHERE marker."transaction_id" = pg_catalog.txid_current() AND marker."school_id" = target_school_id
	) THEN
		RETURN false;
	END IF;
	GET DIAGNOSTICS call_stack = PG_CONTEXT;
	IF pg_catalog.strpos(call_stack, 'function purge_demo_school(text)') = 0 THEN RETURN false; END IF;
	RETURN EXISTS (SELECT 1 FROM "public"."school" WHERE "id" = target_school_id AND "is_demo");
END; $$;--> statement-breakpoint
COMMENT ON FUNCTION "public"."finance_demo_purge_allows"(text) IS 'True only while purge_demo_school() runs for that demo school in this transaction; the single place the demo-purge finance exception is decided.';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."finance_reject_fact_mutation"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
	-- Demo purge exception: see finance_demo_purge_allows(). UPDATE always raises.
	IF TG_OP = 'DELETE' AND "public"."finance_demo_purge_allows"(OLD."school_id") THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'Finance facts are append-only; post a correction or reversal instead';
END; $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."finance_guard_bill_finalization"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE actual_count bigint; actual_total bigint;
BEGIN
	IF TG_OP = 'DELETE' THEN
		-- Demo purge exception: see finance_demo_purge_allows().
		IF OLD."status" = 'posted' AND NOT "public"."finance_demo_purge_allows"(OLD."school_id") THEN RAISE EXCEPTION 'Posted bills are immutable'; END IF;
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
CREATE OR REPLACE FUNCTION "public"."finance_guard_run_finalization"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE actual_count bigint; actual_total bigint; open_count bigint;
BEGIN
	IF TG_OP = 'DELETE' THEN
		-- Demo purge exception: see finance_demo_purge_allows().
		IF OLD."status" = 'posted' AND NOT "public"."finance_demo_purge_allows"(OLD."school_id") THEN RAISE EXCEPTION 'Posted bill runs are immutable'; END IF;
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
-- (user.demo_school_id), in foreign-key dependency order. SECURITY INVOKER.
-- Any new school-owned table must be added here (AGENTS.md "Demo schools").
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

	DELETE FROM "public"."exam_result" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_result', affected);
	DELETE FROM "public"."exam_student_assessment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_student_assessment', affected);
	DELETE FROM "public"."exam_assessment_settings" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_assessment_settings', affected);
	DELETE FROM "public"."exam_timetable" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_timetable', affected);
	DELETE FROM "public"."exam_plan" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_plan', affected);
	DELETE FROM "public"."exam_lifecycle" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_lifecycle', affected);

	DELETE FROM "public"."school_document_template" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_document_template', affected);
	DELETE FROM "public"."artifact" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('artifact', affected);
	DELETE FROM "public"."student" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('student', affected);
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
	DELETE FROM "public"."school_user_role" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_user_role', affected);
	DELETE FROM "public"."school_member" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_member', affected);
	DELETE FROM "public"."school" WHERE "id" = target_school_id;
	DELETE FROM "public"."demo_purge_marker" WHERE "transaction_id" = pg_catalog.txid_current();
	RETURN counts;
END; $$;--> statement-breakpoint
COMMENT ON FUNCTION "public"."purge_demo_school"(text) IS 'Deletes a demo school (is_demo = true) and everything it owns, including demo-only users. Refuses real schools. S3 objects are removed separately by the DemoSchoolPurge workflow from demo_school_purge.';