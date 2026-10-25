ALTER TABLE "legacy_migration_run" DROP CONSTRAINT "legacy_migration_run_hashes_check";--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "target_migration_history_sha256" text NOT NULL;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD CONSTRAINT "legacy_migration_run_hashes_check" CHECK (
      "legacy_migration_run"."source_migration_history_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."target_migration_history_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."source_table_digests_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."importer_checksum_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."mapping_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."approval_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."source_manifest_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."snapshot_evidence_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."exceptions_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."source_dump_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."object_manifest_sha256" ~ '^[0-9a-f]{64}$' AND
      "legacy_migration_run"."decision_set_sha256" ~ '^[0-9a-f]{64}$' AND
      ("legacy_migration_run"."verification_evidence_sha256" IS NULL OR
        "legacy_migration_run"."verification_evidence_sha256" ~ '^[0-9a-f]{64}$') AND
      ("legacy_migration_run"."writes_sha256" IS NULL OR "legacy_migration_run"."writes_sha256" ~ '^[0-9a-f]{64}$') AND
      ("legacy_migration_run"."dispositions_sha256" IS NULL OR "legacy_migration_run"."dispositions_sha256" ~ '^[0-9a-f]{64}$') AND
      ("legacy_migration_run"."audit_exceptions_sha256" IS NULL OR "legacy_migration_run"."audit_exceptions_sha256" ~ '^[0-9a-f]{64}$') AND
      ("legacy_migration_run"."target_after_sha256" IS NULL OR "legacy_migration_run"."target_after_sha256" ~ '^[0-9a-f]{64}$') AND
      ("legacy_migration_run"."reconciliation_sha256" IS NULL OR "legacy_migration_run"."reconciliation_sha256" ~ '^[0-9a-f]{64}$') AND
      ("legacy_migration_run"."run_report_sha256" IS NULL OR "legacy_migration_run"."run_report_sha256" ~ '^[0-9a-f]{64}$')
    );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.legacy_migration_run_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF ROW(NEW.run_id,NEW.school_id,NEW.source_database_identity,NEW.target_database_identity,NEW.source_version,
    NEW.source_migration_history_sha256,NEW.target_migration_history_sha256,NEW.source_table_digests_sha256,
    NEW.importer_git_commit,NEW.importer_checksum_sha256,NEW.mapping_sha256,NEW.approval_sha256,
    NEW.source_manifest_sha256,NEW.snapshot_evidence_sha256,NEW.exceptions_sha256,NEW.source_dump_sha256,
    NEW.object_manifest_sha256,NEW.decision_set_sha256,NEW.target_s3_endpoint,NEW.target_s3_region,
    NEW.target_s3_bucket,NEW.target_s3_force_path_style,NEW.target_postgres_runtime_identity,
    NEW.writer_fence,NEW.writers_disabled,NEW.started_at)
    IS DISTINCT FROM
    ROW(OLD.run_id,OLD.school_id,OLD.source_database_identity,OLD.target_database_identity,OLD.source_version,
    OLD.source_migration_history_sha256,OLD.target_migration_history_sha256,OLD.source_table_digests_sha256,
    OLD.importer_git_commit,OLD.importer_checksum_sha256,OLD.mapping_sha256,OLD.approval_sha256,
    OLD.source_manifest_sha256,OLD.snapshot_evidence_sha256,OLD.exceptions_sha256,OLD.source_dump_sha256,
    OLD.object_manifest_sha256,OLD.decision_set_sha256,OLD.target_s3_endpoint,OLD.target_s3_region,
    OLD.target_s3_bucket,OLD.target_s3_force_path_style,OLD.target_postgres_runtime_identity,
    OLD.writer_fence,OLD.writers_disabled,OLD.started_at)
  THEN RAISE EXCEPTION 'legacy migration provenance is immutable'; END IF;
  IF (OLD.committed_at IS NOT NULL AND OLD.committed_at IS DISTINCT FROM NEW.committed_at) OR
    (OLD.finalized_at IS NOT NULL AND OLD.finalized_at IS DISTINCT FROM NEW.finalized_at) OR
    (OLD.failed_at IS NOT NULL AND OLD.failed_at IS DISTINCT FROM NEW.failed_at)
  THEN RAISE EXCEPTION 'legacy migration lifecycle timestamps are immutable once set'; END IF;
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
  IF NOT (
    (OLD.status='preparing' AND NEW.status IN ('preparing','committed','failed')) OR
    (OLD.status='committed' AND NEW.status IN ('committed','finalized')) OR
    (OLD.status='failed' AND NEW.status='failed') OR
    (OLD.status='finalized' AND NEW.status='finalized')
  ) THEN RAISE EXCEPTION 'invalid legacy migration status transition % -> %',OLD.status,NEW.status; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.legacy_migration_business_writer_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE approved_run text;
DECLARE release_roles_present boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname='campuspilot-plus-migration'
  ) INTO release_roles_present;
  IF EXISTS (
    SELECT 1 FROM public.legacy_migration_run
    WHERE status IN ('preparing','committed')
  ) THEN
    IF release_roles_present AND session_user <> 'campuspilot-plus-migration' THEN
      RAISE EXCEPTION 'target business writes require the dedicated legacy migration login';
    END IF;
    approved_run := pg_catalog.current_setting('campuspilot.legacy_migration_run_id',true);
    IF approved_run IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.legacy_migration_run
      WHERE run_id=approved_run AND status IN ('preparing','committed')
    ) THEN
      RAISE EXCEPTION 'target business writes are fenced by an active legacy migration';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON TABLE public.legacy_migration_run FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.legacy_migration_run_guard() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.legacy_migration_business_writer_guard() FROM PUBLIC;
