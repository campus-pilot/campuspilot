import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const legacyMigrationRunStatusEnum = pgEnum(
  "legacy_migration_run_status",
  ["preparing", "committed", "finalized", "failed"],
);

/**
 * Durable evidence and lifecycle state for one approved legacy migration run.
 * Database and object-store identities are credential-free operator-approved
 * values; credentials must never be persisted with the audit record.
 */
export const legacyMigrationRunTable = pgTable(
  "legacy_migration_run",
  {
    runId: text("run_id").primaryKey(),
    /**
     * This is intentionally not a foreign key: the preparing record must be
     * durable before the imported school row exists and must survive rollback.
     */
    schoolId: text("school_id").notNull(),
    status: legacyMigrationRunStatusEnum("status")
      .notNull()
      .default("preparing"),
    sourceDatabaseIdentity: text("source_database_identity").notNull(),
    targetDatabaseIdentity: text("target_database_identity").notNull(),
    sourceVersion: text("source_version").notNull(),
    sourceMigrationHistorySha256: text(
      "source_migration_history_sha256",
    ).notNull(),
    targetMigrationHistorySha256: text(
      "target_migration_history_sha256",
    ).notNull(),
    sourceTableDigestsSha256: text(
      "source_table_digests_sha256",
    ).notNull(),
    importerGitCommit: text("importer_git_commit").notNull(),
    importerChecksumSha256: text("importer_checksum_sha256").notNull(),
    mappingSha256: text("mapping_sha256").notNull(),
    approvalSha256: text("approval_sha256").notNull(),
    sourceManifestSha256: text("source_manifest_sha256").notNull(),
    snapshotEvidenceSha256: text("snapshot_evidence_sha256").notNull(),
    exceptionsSha256: text("exceptions_sha256").notNull(),
    sourceDumpSha256: text("source_dump_sha256").notNull(),
    objectManifestSha256: text("object_manifest_sha256").notNull(),
    decisionSetSha256: text("decision_set_sha256").notNull(),
    /**
     * S3 destination identity remains decomposed because endpoint, region,
     * bucket, and addressing mode are independent configuration facts.
     */
    targetS3Endpoint: text("target_s3_endpoint"),
    targetS3Region: text("target_s3_region").notNull(),
    targetS3Bucket: text("target_s3_bucket").notNull(),
    targetS3ForcePathStyle: boolean("target_s3_force_path_style").notNull(),
    targetPostgresRuntimeIdentity: jsonb("target_postgres_runtime_identity").notNull(),
    writerFence: jsonb("writer_fence").notNull(),
    /**
     * `none` is the normal state. Only a failure recorded before the importer
     * issues BEGIN may be retried; later phases require manual investigation.
     */
    failureStage: text("failure_stage").notNull().default("none"),
    /** Append-only evidence for explicit same-run pre-transaction retries. */
    retryCount: integer("retry_count").notNull().default(0),
    retryHistory: jsonb("retry_history").notNull().default(sql`'[]'::jsonb`),
    /** Durable verifier attestation used only for post-check finalization recovery. */
    verificationEvidenceSha256: text("verification_evidence_sha256"),
    /** Post-commit audit files must be durably attested before finalization. */
    writesSha256: text("writes_sha256"),
    dispositionsSha256: text("dispositions_sha256"),
    auditExceptionsSha256: text("audit_exceptions_sha256"),
    targetAfterSha256: text("target_after_sha256"),
    reconciliationSha256: text("reconciliation_sha256"),
    runReportSha256: text("run_report_sha256"),
    /** Records the operator-declared target writer-disable gate. */
    writersDisabled: boolean("writers_disabled").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    errorSummary: text("error_summary"),
  },
  (table) => [
    index("legacy_migration_run_school_started_idx").on(
      table.schoolId,
      table.startedAt,
      table.runId,
    ),
    check('legacy_migration_run_hashes_check', sql`
      ${table.sourceMigrationHistorySha256} ~ '^[0-9a-f]{64}$' AND
      ${table.targetMigrationHistorySha256} ~ '^[0-9a-f]{64}$' AND
      ${table.sourceTableDigestsSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.importerChecksumSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.mappingSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.approvalSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.sourceManifestSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.snapshotEvidenceSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.exceptionsSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.sourceDumpSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.objectManifestSha256} ~ '^[0-9a-f]{64}$' AND
      ${table.decisionSetSha256} ~ '^[0-9a-f]{64}$' AND
      (${table.verificationEvidenceSha256} IS NULL OR
        ${table.verificationEvidenceSha256} ~ '^[0-9a-f]{64}$') AND
      (${table.writesSha256} IS NULL OR ${table.writesSha256} ~ '^[0-9a-f]{64}$') AND
      (${table.dispositionsSha256} IS NULL OR ${table.dispositionsSha256} ~ '^[0-9a-f]{64}$') AND
      (${table.auditExceptionsSha256} IS NULL OR ${table.auditExceptionsSha256} ~ '^[0-9a-f]{64}$') AND
      (${table.targetAfterSha256} IS NULL OR ${table.targetAfterSha256} ~ '^[0-9a-f]{64}$') AND
      (${table.reconciliationSha256} IS NULL OR ${table.reconciliationSha256} ~ '^[0-9a-f]{64}$') AND
      (${table.runReportSha256} IS NULL OR ${table.runReportSha256} ~ '^[0-9a-f]{64}$')
    `),
    check('legacy_migration_run_lifecycle_check', sql`
      (${table.status} = 'preparing' AND ${table.failureStage} = 'none' AND ${table.committedAt} IS NULL AND ${table.finalizedAt} IS NULL) OR
      (${table.status} = 'committed' AND ${table.failureStage} = 'none' AND ${table.committedAt} IS NOT NULL AND ${table.finalizedAt} IS NULL) OR
      (${table.status} = 'finalized' AND ${table.failureStage} = 'none' AND ${table.committedAt} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL AND
        ${table.verificationEvidenceSha256} IS NOT NULL AND ${table.writesSha256} IS NOT NULL AND
        ${table.dispositionsSha256} IS NOT NULL AND ${table.auditExceptionsSha256} IS NOT NULL AND
        ${table.targetAfterSha256} IS NOT NULL AND ${table.reconciliationSha256} IS NOT NULL AND
        ${table.runReportSha256} IS NOT NULL) OR
      (${table.status} = 'failed' AND ${table.failureStage} IN ('pre_transaction', 'transaction_started') AND
        ${table.failedAt} IS NOT NULL AND ${table.committedAt} IS NULL)
    `),
    check('legacy_migration_run_retry_check', sql`
      ${table.retryCount} >= 0 AND jsonb_typeof(${table.retryHistory}) = 'array' AND
      jsonb_array_length(${table.retryHistory}) = ${table.retryCount}
    `),
  ],
);
