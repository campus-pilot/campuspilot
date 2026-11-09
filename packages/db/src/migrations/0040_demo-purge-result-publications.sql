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
	DELETE FROM "public"."exam_result" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_result', affected);
	DELETE FROM "public"."exam_student_assessment" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_student_assessment', affected);
	DELETE FROM "public"."exam_assessment_settings" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_assessment_settings', affected);
	DELETE FROM "public"."exam_timetable" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_timetable', affected);
	DELETE FROM "public"."exam_plan" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_plan', affected);
	DELETE FROM "public"."exam_lifecycle" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('exam_lifecycle', affected);

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
	DELETE FROM "public"."school_user_role" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_user_role', affected);
	DELETE FROM "public"."school_member" WHERE "school_id" = target_school_id; GET DIAGNOSTICS affected = ROW_COUNT; counts := counts || jsonb_build_object('school_member', affected);
	DELETE FROM "public"."school" WHERE "id" = target_school_id;
	DELETE FROM "public"."demo_purge_marker" WHERE "transaction_id" = pg_catalog.txid_current();
	RETURN counts;
END; $$;--> statement-breakpoint
COMMENT ON FUNCTION "public"."purge_demo_school"(text) IS 'Deletes a demo school (is_demo = true) and everything it owns, including demo-only users, the Cadet Portal logins of its admissions (with their push subscriptions), its notifications and its exam result publications. Refuses real schools. S3 objects are removed separately by the DemoSchoolPurge workflow from demo_school_purge.';
