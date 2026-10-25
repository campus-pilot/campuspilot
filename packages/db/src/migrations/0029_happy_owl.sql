ALTER TABLE "legacy_migration_run" DROP CONSTRAINT "legacy_migration_run_lifecycle_check";--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "failure_stage" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "retry_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE public.legacy_migration_run
SET failure_stage = CASE
  WHEN run_id='prem-20261025t090000z' AND school_id='sch_n6q4pmirqg7dpct1pr8pr'
    AND error_summary ~ '^Invalid preserved (user|account) ID: [A-Za-z0-9]{32}$'
    AND committed_at IS NULL AND finalized_at IS NULL
    AND verification_evidence_sha256 IS NULL AND writes_sha256 IS NULL
    AND dispositions_sha256 IS NULL AND audit_exceptions_sha256 IS NULL
    AND target_after_sha256 IS NULL AND reconciliation_sha256 IS NULL
    AND run_report_sha256 IS NULL
  THEN 'pre_transaction'
  ELSE 'transaction_started'
END
WHERE status='failed';--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD CONSTRAINT "legacy_migration_run_retry_check" CHECK (
      "legacy_migration_run"."retry_count" >= 0 AND jsonb_typeof("legacy_migration_run"."retry_history") = 'array' AND
      jsonb_array_length("legacy_migration_run"."retry_history") = "legacy_migration_run"."retry_count"
    );--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD CONSTRAINT "legacy_migration_run_lifecycle_check" CHECK (
      ("legacy_migration_run"."status" = 'preparing' AND "legacy_migration_run"."failure_stage" = 'none' AND "legacy_migration_run"."committed_at" IS NULL AND "legacy_migration_run"."finalized_at" IS NULL) OR
      ("legacy_migration_run"."status" = 'committed' AND "legacy_migration_run"."failure_stage" = 'none' AND "legacy_migration_run"."committed_at" IS NOT NULL AND "legacy_migration_run"."finalized_at" IS NULL) OR
      ("legacy_migration_run"."status" = 'finalized' AND "legacy_migration_run"."failure_stage" = 'none' AND "legacy_migration_run"."committed_at" IS NOT NULL AND "legacy_migration_run"."finalized_at" IS NOT NULL AND
        "legacy_migration_run"."verification_evidence_sha256" IS NOT NULL AND "legacy_migration_run"."writes_sha256" IS NOT NULL AND
        "legacy_migration_run"."dispositions_sha256" IS NOT NULL AND "legacy_migration_run"."audit_exceptions_sha256" IS NOT NULL AND
        "legacy_migration_run"."target_after_sha256" IS NOT NULL AND "legacy_migration_run"."reconciliation_sha256" IS NOT NULL AND
        "legacy_migration_run"."run_report_sha256" IS NOT NULL) OR
      ("legacy_migration_run"."status" = 'failed' AND "legacy_migration_run"."failure_stage" IN ('pre_transaction', 'transaction_started') AND
        "legacy_migration_run"."failed_at" IS NOT NULL AND "legacy_migration_run"."committed_at" IS NULL)
    );--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.legacy_migration_run_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE retry_transition boolean;
DECLARE retry_evidence jsonb;
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
      OLD.school_id <> 'sch_n6q4pmirqg7dpct1pr8pr' OR
      OLD.failure_stage <> 'pre_transaction' OR NEW.failure_stage <> 'none' OR
      OLD.failed_at IS NULL OR OLD.error_summary IS NULL OR
      OLD.error_summary !~ '^Invalid preserved (user|account) ID: [A-Za-z0-9]{32}$' OR
      OLD.committed_at IS NOT NULL OR OLD.finalized_at IS NOT NULL OR
      OLD.verification_evidence_sha256 IS NOT NULL OR OLD.writes_sha256 IS NOT NULL OR
      OLD.dispositions_sha256 IS NOT NULL OR OLD.audit_exceptions_sha256 IS NOT NULL OR
      OLD.target_after_sha256 IS NOT NULL OR OLD.reconciliation_sha256 IS NOT NULL OR
      OLD.run_report_sha256 IS NOT NULL OR NEW.error_summary IS NOT NULL OR
      OLD.retry_count <> 0 OR OLD.retry_history <> '[]'::jsonb OR
      NEW.retry_count <> OLD.retry_count + 1 OR
      jsonb_array_length(NEW.retry_history) <> jsonb_array_length(OLD.retry_history) + 1 OR
      NEW.retry_history - (jsonb_array_length(NEW.retry_history) - 1) <> OLD.retry_history
    THEN RAISE EXCEPTION 'failed migration run does not satisfy safe retry requirements'; END IF;
    retry_evidence := NEW.retry_history -> (jsonb_array_length(NEW.retry_history) - 1);
    IF (retry_evidence #>> '{previousFailure,failedAt}')::timestamptz IS DISTINCT FROM OLD.failed_at OR
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
      (retry_evidence->>'retriedAt')::timestamptz IS DISTINCT FROM NEW.updated_at
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
END $$;
