ALTER TABLE "legacy_migration_run" DROP CONSTRAINT "legacy_migration_run_hashes_check";--> statement-breakpoint
ALTER TABLE "legacy_migration_run" DROP CONSTRAINT "legacy_migration_run_lifecycle_check";--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "writes_sha256" text;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "dispositions_sha256" text;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "audit_exceptions_sha256" text;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "target_after_sha256" text;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "reconciliation_sha256" text;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD COLUMN "run_report_sha256" text;--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD CONSTRAINT "legacy_migration_run_hashes_check" CHECK (
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
    );--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD CONSTRAINT "legacy_migration_run_lifecycle_check" CHECK (
      ("legacy_migration_run"."status" = 'preparing' AND "legacy_migration_run"."committed_at" IS NULL AND "legacy_migration_run"."finalized_at" IS NULL) OR
      ("legacy_migration_run"."status" = 'committed' AND "legacy_migration_run"."committed_at" IS NOT NULL AND "legacy_migration_run"."finalized_at" IS NULL) OR
      ("legacy_migration_run"."status" = 'finalized' AND "legacy_migration_run"."committed_at" IS NOT NULL AND "legacy_migration_run"."finalized_at" IS NOT NULL AND
        "legacy_migration_run"."verification_evidence_sha256" IS NOT NULL AND "legacy_migration_run"."writes_sha256" IS NOT NULL AND
        "legacy_migration_run"."dispositions_sha256" IS NOT NULL AND "legacy_migration_run"."audit_exceptions_sha256" IS NOT NULL AND
        "legacy_migration_run"."target_after_sha256" IS NOT NULL AND "legacy_migration_run"."reconciliation_sha256" IS NOT NULL AND
        "legacy_migration_run"."run_report_sha256" IS NOT NULL) OR
      ("legacy_migration_run"."status" = 'failed' AND "legacy_migration_run"."failed_at" IS NOT NULL AND "legacy_migration_run"."committed_at" IS NULL)
    );--> statement-breakpoint
CREATE OR REPLACE FUNCTION legacy_migration_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.run_id,NEW.school_id,NEW.source_database_identity,NEW.target_database_identity,NEW.source_version,
    NEW.source_migration_history_sha256,NEW.source_table_digests_sha256,NEW.importer_git_commit,
    NEW.importer_checksum_sha256,NEW.mapping_sha256,NEW.approval_sha256,NEW.source_manifest_sha256,
    NEW.snapshot_evidence_sha256,NEW.exceptions_sha256,NEW.source_dump_sha256,NEW.object_manifest_sha256,
    NEW.decision_set_sha256,NEW.target_s3_endpoint,NEW.target_s3_region,NEW.target_s3_bucket,
    NEW.target_s3_force_path_style,NEW.target_postgres_runtime_identity,NEW.writer_fence,NEW.writers_disabled,NEW.started_at)
    IS DISTINCT FROM
    ROW(OLD.run_id,OLD.school_id,OLD.source_database_identity,OLD.target_database_identity,OLD.source_version,
    OLD.source_migration_history_sha256,OLD.source_table_digests_sha256,OLD.importer_git_commit,
    OLD.importer_checksum_sha256,OLD.mapping_sha256,OLD.approval_sha256,OLD.source_manifest_sha256,
    OLD.snapshot_evidence_sha256,OLD.exceptions_sha256,OLD.source_dump_sha256,OLD.object_manifest_sha256,
    OLD.decision_set_sha256,OLD.target_s3_endpoint,OLD.target_s3_region,OLD.target_s3_bucket,
    OLD.target_s3_force_path_style,OLD.target_postgres_runtime_identity,OLD.writer_fence,OLD.writers_disabled,OLD.started_at)
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
CREATE FUNCTION legacy_migration_business_writer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved_run text;
BEGIN
  IF EXISTS (SELECT 1 FROM legacy_migration_run WHERE status IN ('preparing','committed')) THEN
    approved_run := current_setting('campuspilot.legacy_migration_run_id',true);
    IF approved_run IS NULL OR NOT EXISTS (
      SELECT 1 FROM legacy_migration_run
      WHERE run_id=approved_run AND status IN ('preparing','committed')
    ) THEN
      RAISE EXCEPTION 'target business writes are fenced by an active legacy migration';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE target_table record;
BEGIN
  FOR target_table IN
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename<>'legacy_migration_run'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER legacy_migration_business_writer_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION legacy_migration_business_writer_guard()',
      target_table.tablename
    );
  END LOOP;
END $$;
