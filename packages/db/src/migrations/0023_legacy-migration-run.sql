CREATE TYPE "public"."legacy_migration_run_status" AS ENUM('preparing', 'committed', 'finalized', 'failed');--> statement-breakpoint
CREATE TABLE "legacy_migration_run" (
	"run_id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"status" "legacy_migration_run_status" DEFAULT 'preparing' NOT NULL,
	"source_database_identity" text NOT NULL,
	"target_database_identity" text NOT NULL,
	"source_version" text NOT NULL,
	"source_migration_history_sha256" text NOT NULL,
	"source_table_digests_sha256" text NOT NULL,
	"importer_git_commit" text NOT NULL,
	"importer_checksum_sha256" text NOT NULL,
	"mapping_sha256" text NOT NULL,
	"approval_sha256" text NOT NULL,
	"source_manifest_sha256" text NOT NULL,
	"exceptions_sha256" text NOT NULL,
	"source_dump_sha256" text NOT NULL,
	"object_manifest_sha256" text NOT NULL,
	"decision_set_sha256" text NOT NULL,
	"target_s3_endpoint" text,
	"target_s3_region" text NOT NULL,
	"target_s3_bucket" text NOT NULL,
	"target_s3_force_path_style" boolean NOT NULL,
	"writers_disabled" boolean NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_summary" text
);
--> statement-breakpoint
CREATE INDEX "legacy_migration_run_school_started_idx" ON "legacy_migration_run" USING btree ("school_id","started_at","run_id");