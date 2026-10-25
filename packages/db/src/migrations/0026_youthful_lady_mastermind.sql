ALTER TABLE "legacy_migration_run" DROP CONSTRAINT "legacy_migration_run_lifecycle_check";--> statement-breakpoint
ALTER TABLE "legacy_migration_run" ADD CONSTRAINT "legacy_migration_run_lifecycle_check" CHECK (
      ("legacy_migration_run"."status" = 'preparing' AND "legacy_migration_run"."committed_at" IS NULL AND "legacy_migration_run"."finalized_at" IS NULL) OR
      ("legacy_migration_run"."status" = 'committed' AND "legacy_migration_run"."committed_at" IS NOT NULL AND "legacy_migration_run"."finalized_at" IS NULL) OR
      ("legacy_migration_run"."status" = 'finalized' AND "legacy_migration_run"."committed_at" IS NOT NULL AND "legacy_migration_run"."finalized_at" IS NOT NULL AND "legacy_migration_run"."verification_evidence_sha256" IS NOT NULL) OR
      ("legacy_migration_run"."status" = 'failed' AND "legacy_migration_run"."failed_at" IS NOT NULL AND "legacy_migration_run"."committed_at" IS NULL)
    );