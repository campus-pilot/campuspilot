ALTER TABLE "legacy_migration_run" DROP CONSTRAINT "legacy_migration_run_retry_check";--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD CONSTRAINT "legacy_migration_run_retry_check" CHECK (
      "legacy_migration_run"."retry_count" BETWEEN 0 AND 2 AND jsonb_typeof("legacy_migration_run"."retry_history") = 'array' AND
      jsonb_array_length("legacy_migration_run"."retry_history") = "legacy_migration_run"."retry_count"
    );--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.legacy_migration_run) AND (
    (SELECT count(*) FROM public.legacy_migration_run) <> 1 OR
    NOT EXISTS (
      SELECT 1
      FROM public.legacy_migration_run AS run
      WHERE run.run_id='prem-20261025t090000z' AND
        run.school_id='sch_n6q4pmirqg7dpct1pr8pr' AND
        run.status='failed' AND run.failure_stage='transaction_started' AND
        run.failed_at='2026-10-25 09:31:27.709568+00'::timestamptz AND
        run.updated_at='2026-10-25 10:01:03.478112+00'::timestamptz AND
        run.error_summary='Cannot read properties of undefined (reading ''byteLength'')' AND
        run.retry_count=1 AND jsonb_array_length(run.retry_history)=1 AND
        run.committed_at IS NULL AND run.finalized_at IS NULL AND
        run.verification_evidence_sha256 IS NULL AND run.writes_sha256 IS NULL AND
        run.dispositions_sha256 IS NULL AND run.audit_exceptions_sha256 IS NULL AND
        run.target_after_sha256 IS NULL AND run.reconciliation_sha256 IS NULL AND
        run.run_report_sha256 IS NULL AND
        run.target_migration_history_sha256='6b1703a90f5dea5690e95e4f479a001287e8c9fc09b57f47c69a976462388e04' AND
        run.importer_git_commit='76debfaaf77ef8e71c2cb0892920e5d9809e5db7' AND
        run.importer_checksum_sha256='49ca2e792dde48d002095065c11795b79f6cd043b435b667c198cf6fff7fc1a4' AND
        run.approval_sha256='62bacb2466c46eb99c114a9bc6dcc07cd7db37b82948d1f810ab6e98eb70e605' AND
        run.decision_set_sha256='fd23a0ae59e5840e4896a3e6edc08a518ac5ccea0ff795441a0fc44a472164b4' AND
        (run.retry_history->0) - 'retriedAt' - 'previousFailure' - 'previousProvenance' - 'replacementProvenance' = '{}'::jsonb AND
        run.retry_history->0->>'retriedAt'='2026-10-25T10:00:55.651Z' AND
        (run.retry_history->0 #> '{previousFailure}') - 'failedAt' - 'errorSummary' = '{}'::jsonb AND
        run.retry_history->0 #>> '{previousFailure,failedAt}'='2026-10-25T09:31:27.709568+00:00' AND
        encode(sha256(convert_to(run.retry_history->0 #>> '{previousFailure,errorSummary}','UTF8')),'hex')=
          '969b6935bc2f6041844eecf742c65ba2ff2e50b3ca468439e11f34d776658173' AND
        run.retry_history->0 #> '{previousProvenance}'=
          '{"approvalSha256":"73e9567e59afb9a249150b082d2b0961082ddc7d336ec0e4e516789be00165cb","importerGitCommit":"c5f3da7548277e6fae10137e7b0b0c9069c1082c","importerChecksumSha256":"7943f31968482625236c8cdec9579cf9b450b1acea30b27af45e3c41a11d458d","targetMigrationHistorySha256":"0e1e5e202dc7a7878c3ec51649c0c0df31dca9c37cd9a39c2fa8d05459067327","trackedDecisionAndDocsSha256":"06dc1f56d8cf3f3527e75320d99392e21543326c3a87b3776098651512d0d814"}'::jsonb AND
        run.retry_history->0 #> '{replacementProvenance}'=
          '{"approvalSha256":"62bacb2466c46eb99c114a9bc6dcc07cd7db37b82948d1f810ab6e98eb70e605","importerGitCommit":"76debfaaf77ef8e71c2cb0892920e5d9809e5db7","importerChecksumSha256":"49ca2e792dde48d002095065c11795b79f6cd043b435b667c198cf6fff7fc1a4","targetMigrationHistorySha256":"6b1703a90f5dea5690e95e4f479a001287e8c9fc09b57f47c69a976462388e04","trackedDecisionAndDocsSha256":"fd23a0ae59e5840e4896a3e6edc08a518ac5ccea0ff795441a0fc44a472164b4"}'::jsonb
    )
  ) THEN
    RAISE EXCEPTION '0030 recovery preflight found an unexpected durable migration row';
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.legacy_migration_run_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE retry_transition boolean;
DECLARE retry_evidence jsonb;
DECLARE first_retry_evidence jsonb;
DECLARE retry_kind text;
DECLARE business_relation record;
DECLARE business_row_exists boolean;
BEGIN
  retry_transition := OLD.status='failed' AND NEW.status='preparing';

  IF ROW(NEW.run_id,NEW.school_id,NEW.source_database_identity,NEW.target_database_identity,NEW.source_version,
    NEW.source_migration_history_sha256,NEW.source_table_digests_sha256,NEW.mapping_sha256,
    NEW.source_manifest_sha256,NEW.snapshot_evidence_sha256,NEW.exceptions_sha256,NEW.source_dump_sha256,
    NEW.object_manifest_sha256,NEW.target_s3_endpoint,NEW.target_s3_region,
    NEW.target_s3_bucket,NEW.target_s3_force_path_style,NEW.target_postgres_runtime_identity,
    NEW.writer_fence,NEW.writers_disabled,NEW.started_at)
    IS DISTINCT FROM
    ROW(OLD.run_id,OLD.school_id,OLD.source_database_identity,OLD.target_database_identity,OLD.source_version,
    OLD.source_migration_history_sha256,OLD.source_table_digests_sha256,OLD.mapping_sha256,
    OLD.source_manifest_sha256,OLD.snapshot_evidence_sha256,OLD.exceptions_sha256,OLD.source_dump_sha256,
    OLD.object_manifest_sha256,OLD.target_s3_endpoint,OLD.target_s3_region,
    OLD.target_s3_bucket,OLD.target_s3_force_path_style,OLD.target_postgres_runtime_identity,
    OLD.writer_fence,OLD.writers_disabled,OLD.started_at)
  THEN RAISE EXCEPTION 'legacy migration provenance is immutable'; END IF;

  IF ROW(NEW.target_migration_history_sha256,NEW.importer_git_commit,
    NEW.importer_checksum_sha256,NEW.approval_sha256,NEW.decision_set_sha256)
    IS DISTINCT FROM ROW(OLD.target_migration_history_sha256,OLD.importer_git_commit,
    OLD.importer_checksum_sha256,OLD.approval_sha256,OLD.decision_set_sha256) AND NOT retry_transition
  THEN RAISE EXCEPTION 'legacy migration executable provenance is immutable outside retry'; END IF;

  IF (OLD.committed_at IS NOT NULL AND OLD.committed_at IS DISTINCT FROM NEW.committed_at) OR
    (OLD.finalized_at IS NOT NULL AND OLD.finalized_at IS DISTINCT FROM NEW.finalized_at) OR
    (OLD.failed_at IS NOT NULL AND OLD.failed_at IS DISTINCT FROM NEW.failed_at)
  THEN RAISE EXCEPTION 'legacy migration lifecycle timestamps are immutable once set'; END IF;
  IF OLD.error_summary IS DISTINCT FROM NEW.error_summary AND NOT (
    (OLD.status='preparing' AND NEW.status='failed' AND
      OLD.error_summary IS NULL AND NEW.error_summary IS NOT NULL) OR
    (retry_transition AND OLD.error_summary IS NOT NULL AND NEW.error_summary IS NULL) OR
    (OLD.status='committed' AND NEW.status='committed' AND
      OLD.error_summary IS NULL AND NEW.error_summary IS NOT NULL)
  ) THEN RAISE EXCEPTION 'legacy migration error summary is immutable outside its lifecycle transition'; END IF;
  IF OLD.status='failed' AND NEW.status='failed' AND OLD.updated_at IS DISTINCT FROM NEW.updated_at
  THEN RAISE EXCEPTION 'legacy migration failed-state timestamp is immutable'; END IF;
  IF OLD.verification_evidence_sha256 IS DISTINCT FROM NEW.verification_evidence_sha256 AND NOT (
    OLD.status='committed' AND NEW.status='committed' AND
    OLD.verification_evidence_sha256 IS NULL AND NEW.verification_evidence_sha256 IS NOT NULL
  ) THEN RAISE EXCEPTION 'legacy migration verification attestation is immutable'; END IF;
  IF ROW(OLD.writes_sha256,OLD.dispositions_sha256,OLD.audit_exceptions_sha256,
    OLD.target_after_sha256,OLD.reconciliation_sha256,OLD.run_report_sha256)
    IS DISTINCT FROM ROW(NEW.writes_sha256,NEW.dispositions_sha256,NEW.audit_exceptions_sha256,
    NEW.target_after_sha256,NEW.reconciliation_sha256,NEW.run_report_sha256) AND NOT (
      OLD.status='committed' AND NEW.status='committed' AND
      OLD.writes_sha256 IS NULL AND NEW.writes_sha256 IS NOT NULL AND
      OLD.dispositions_sha256 IS NULL AND NEW.dispositions_sha256 IS NOT NULL AND
      OLD.audit_exceptions_sha256 IS NULL AND NEW.audit_exceptions_sha256 IS NOT NULL AND
      OLD.target_after_sha256 IS NULL AND NEW.target_after_sha256 IS NOT NULL AND
      OLD.reconciliation_sha256 IS NULL AND NEW.reconciliation_sha256 IS NOT NULL AND
      OLD.run_report_sha256 IS NULL AND NEW.run_report_sha256 IS NOT NULL
    )
  THEN RAISE EXCEPTION 'legacy migration audit attestations are immutable'; END IF;

  IF retry_transition THEN
    IF OLD.run_id <> 'prem-20261025t090000z' OR
      OLD.school_id <> 'sch_n6q4pmirqg7dpct1pr8pr' OR NEW.failure_stage <> 'none' OR
      OLD.failed_at IS NULL OR OLD.error_summary IS NULL OR
      OLD.committed_at IS NOT NULL OR OLD.finalized_at IS NOT NULL OR
      OLD.verification_evidence_sha256 IS NOT NULL OR OLD.writes_sha256 IS NOT NULL OR
      OLD.dispositions_sha256 IS NOT NULL OR OLD.audit_exceptions_sha256 IS NOT NULL OR
      OLD.target_after_sha256 IS NOT NULL OR OLD.reconciliation_sha256 IS NOT NULL OR
      OLD.run_report_sha256 IS NOT NULL OR NEW.error_summary IS NOT NULL OR
      NEW.retry_count <> OLD.retry_count + 1 OR
      jsonb_array_length(NEW.retry_history) <> jsonb_array_length(OLD.retry_history) + 1 OR
      NEW.retry_history - (jsonb_array_length(NEW.retry_history) - 1) <> OLD.retry_history
    THEN RAISE EXCEPTION 'failed migration run does not satisfy safe retry requirements'; END IF;

    IF OLD.failure_stage='pre_transaction' AND OLD.retry_count=0 AND OLD.retry_history='[]'::jsonb AND
      OLD.error_summary ~ '^Invalid preserved (user|account) ID: [A-Za-z0-9]{32}$'
    THEN
      retry_kind := 'legacy-auth-id-v1';
    ELSIF OLD.failure_stage='transaction_started' AND OLD.retry_count=1 AND
      jsonb_array_length(OLD.retry_history)=1 AND
      OLD.error_summary='Cannot read properties of undefined (reading ''byteLength'')' AND
      OLD.updated_at='2026-10-25 10:01:03.478112+00'::timestamptz AND
      OLD.target_migration_history_sha256='6b1703a90f5dea5690e95e4f479a001287e8c9fc09b57f47c69a976462388e04' AND
      OLD.importer_git_commit='76debfaaf77ef8e71c2cb0892920e5d9809e5db7' AND
      OLD.importer_checksum_sha256='49ca2e792dde48d002095065c11795b79f6cd043b435b667c198cf6fff7fc1a4' AND
      OLD.approval_sha256='62bacb2466c46eb99c114a9bc6dcc07cd7db37b82948d1f810ab6e98eb70e605' AND
      OLD.decision_set_sha256='fd23a0ae59e5840e4896a3e6edc08a518ac5ccea0ff795441a0fc44a472164b4'
    THEN
      first_retry_evidence := OLD.retry_history -> 0;
      IF (first_retry_evidence) - 'retriedAt' - 'previousFailure' - 'previousProvenance' - 'replacementProvenance' <> '{}'::jsonb OR
        first_retry_evidence->>'retriedAt' IS DISTINCT FROM '2026-10-25T10:00:55.651Z' OR
        (first_retry_evidence #> '{previousFailure}') - 'failedAt' - 'errorSummary' <> '{}'::jsonb OR
        first_retry_evidence #>> '{previousFailure,failedAt}' IS DISTINCT FROM '2026-10-25T09:31:27.709568+00:00' OR
        encode(sha256(convert_to(coalesce(first_retry_evidence #>> '{previousFailure,errorSummary}',''),'UTF8')),'hex') <>
          '969b6935bc2f6041844eecf742c65ba2ff2e50b3ca468439e11f34d776658173' OR
        coalesce(first_retry_evidence #>> '{previousFailure,errorSummary}','') !~ '^Invalid preserved (user|account) ID: [A-Za-z0-9]{32}$' OR
        first_retry_evidence #> '{previousProvenance}' IS DISTINCT FROM
          '{"approvalSha256":"73e9567e59afb9a249150b082d2b0961082ddc7d336ec0e4e516789be00165cb","importerGitCommit":"c5f3da7548277e6fae10137e7b0b0c9069c1082c","importerChecksumSha256":"7943f31968482625236c8cdec9579cf9b450b1acea30b27af45e3c41a11d458d","targetMigrationHistorySha256":"0e1e5e202dc7a7878c3ec51649c0c0df31dca9c37cd9a39c2fa8d05459067327","trackedDecisionAndDocsSha256":"06dc1f56d8cf3f3527e75320d99392e21543326c3a87b3776098651512d0d814"}'::jsonb OR
        first_retry_evidence #> '{replacementProvenance}' IS DISTINCT FROM
          '{"approvalSha256":"62bacb2466c46eb99c114a9bc6dcc07cd7db37b82948d1f810ab6e98eb70e605","importerGitCommit":"76debfaaf77ef8e71c2cb0892920e5d9809e5db7","importerChecksumSha256":"49ca2e792dde48d002095065c11795b79f6cd043b435b667c198cf6fff7fc1a4","targetMigrationHistorySha256":"6b1703a90f5dea5690e95e4f479a001287e8c9fc09b57f47c69a976462388e04","trackedDecisionAndDocsSha256":"fd23a0ae59e5840e4896a3e6edc08a518ac5ccea0ff795441a0fc44a472164b4"}'::jsonb OR
        (first_retry_evidence->>'retriedAt')::timestamptz IS NULL OR
        (first_retry_evidence->>'retriedAt')::timestamptz <= OLD.failed_at OR
        (first_retry_evidence->>'retriedAt')::timestamptz >= OLD.updated_at OR
        first_retry_evidence #>> '{replacementProvenance,targetMigrationHistorySha256}' IS DISTINCT FROM OLD.target_migration_history_sha256 OR
        first_retry_evidence #>> '{replacementProvenance,importerGitCommit}' IS DISTINCT FROM OLD.importer_git_commit OR
        first_retry_evidence #>> '{replacementProvenance,importerChecksumSha256}' IS DISTINCT FROM OLD.importer_checksum_sha256 OR
        first_retry_evidence #>> '{replacementProvenance,approvalSha256}' IS DISTINCT FROM OLD.approval_sha256 OR
        first_retry_evidence #>> '{replacementProvenance,trackedDecisionAndDocsSha256}' IS DISTINCT FROM OLD.decision_set_sha256
      THEN RAISE EXCEPTION 'existing first retry evidence is invalid for template byte-size recovery'; END IF;

      retry_kind := 'template-byte-size-v1';
    ELSE
      RAISE EXCEPTION 'failed migration run does not satisfy safe retry requirements';
    END IF;

    FOR business_relation IN
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname='public' AND tablename <> 'legacy_migration_run'
      ORDER BY tablename
    LOOP
      EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', business_relation.tablename)
        INTO business_row_exists;
      IF business_row_exists THEN
        RAISE EXCEPTION 'migration recovery requires every target business table to remain empty';
      END IF;
    END LOOP;

    retry_evidence := NEW.retry_history -> (jsonb_array_length(NEW.retry_history) - 1);
    IF (retry_kind='legacy-auth-id-v1' AND (retry_evidence) ? 'recoveryKind') OR
      (retry_kind='template-byte-size-v1' AND retry_evidence->>'recoveryKind' IS DISTINCT FROM retry_kind) OR
      (retry_kind='template-byte-size-v1' AND (
        (retry_evidence) - 'recoveryKind' - 'retriedAt' - 'previousFailure' - 'previousProvenance' - 'replacementProvenance' <> '{}'::jsonb OR
        (retry_evidence #> '{previousFailure}') - 'failedAt' - 'errorSummary' <> '{}'::jsonb OR
        retry_evidence #> '{previousProvenance}' IS DISTINCT FROM jsonb_build_object(
          'targetMigrationHistorySha256',OLD.target_migration_history_sha256,
          'importerGitCommit',OLD.importer_git_commit,
          'importerChecksumSha256',OLD.importer_checksum_sha256,
          'approvalSha256',OLD.approval_sha256,
          'trackedDecisionAndDocsSha256',OLD.decision_set_sha256) OR
        retry_evidence #> '{replacementProvenance}' IS DISTINCT FROM jsonb_build_object(
          'targetMigrationHistorySha256',NEW.target_migration_history_sha256,
          'importerGitCommit',NEW.importer_git_commit,
          'importerChecksumSha256',NEW.importer_checksum_sha256,
          'approvalSha256',NEW.approval_sha256,
          'trackedDecisionAndDocsSha256',NEW.decision_set_sha256)
      )) OR
      (retry_evidence #>> '{previousFailure,failedAt}')::timestamptz IS DISTINCT FROM
        CASE WHEN retry_kind='template-byte-size-v1' THEN OLD.updated_at ELSE OLD.failed_at END OR
      retry_evidence #>> '{previousFailure,errorSummary}' IS DISTINCT FROM OLD.error_summary OR
      retry_evidence #>> '{previousProvenance,targetMigrationHistorySha256}' IS DISTINCT FROM OLD.target_migration_history_sha256 OR
      retry_evidence #>> '{previousProvenance,importerGitCommit}' IS DISTINCT FROM OLD.importer_git_commit OR
      retry_evidence #>> '{previousProvenance,importerChecksumSha256}' IS DISTINCT FROM OLD.importer_checksum_sha256 OR
      retry_evidence #>> '{previousProvenance,approvalSha256}' IS DISTINCT FROM OLD.approval_sha256 OR
      retry_evidence #>> '{previousProvenance,trackedDecisionAndDocsSha256}' IS DISTINCT FROM OLD.decision_set_sha256 OR
      retry_evidence #>> '{replacementProvenance,targetMigrationHistorySha256}' IS DISTINCT FROM NEW.target_migration_history_sha256 OR
      retry_evidence #>> '{replacementProvenance,importerGitCommit}' IS DISTINCT FROM NEW.importer_git_commit OR
      retry_evidence #>> '{replacementProvenance,importerChecksumSha256}' IS DISTINCT FROM NEW.importer_checksum_sha256 OR
      retry_evidence #>> '{replacementProvenance,approvalSha256}' IS DISTINCT FROM NEW.approval_sha256 OR
      retry_evidence #>> '{replacementProvenance,trackedDecisionAndDocsSha256}' IS DISTINCT FROM NEW.decision_set_sha256 OR
      (retry_evidence->>'retriedAt')::timestamptz IS DISTINCT FROM NEW.updated_at OR
      (retry_evidence->>'retriedAt')::timestamptz <=
        CASE WHEN retry_kind='template-byte-size-v1' THEN OLD.updated_at ELSE OLD.failed_at END OR
      (retry_kind='template-byte-size-v1' AND
        (retry_evidence->>'retriedAt')::timestamptz <= (first_retry_evidence->>'retriedAt')::timestamptz)
    THEN RAISE EXCEPTION 'legacy migration retry evidence does not bind old and replacement provenance'; END IF;
  ELSE
    IF OLD.retry_count IS DISTINCT FROM NEW.retry_count OR OLD.retry_history IS DISTINCT FROM NEW.retry_history
    THEN RAISE EXCEPTION 'legacy migration retry evidence is append-only'; END IF;
    IF OLD.failure_stage IS DISTINCT FROM NEW.failure_stage AND NOT (
      OLD.status='preparing' AND NEW.status='failed' AND OLD.failure_stage='none' AND
      NEW.failure_stage IN ('pre_transaction','transaction_started')
    ) THEN RAISE EXCEPTION 'invalid legacy migration failure stage transition'; END IF;
  END IF;

  IF NOT (
    (OLD.status='preparing' AND NEW.status IN ('preparing','committed','failed')) OR
    (OLD.status='committed' AND NEW.status IN ('committed','finalized')) OR
    (OLD.status='failed' AND NEW.status IN ('failed','preparing')) OR
    (OLD.status='finalized' AND NEW.status='finalized')
  ) THEN RAISE EXCEPTION 'invalid legacy migration status transition % -> %',OLD.status,NEW.status; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.legacy_migration_run_guard() FROM PUBLIC;
