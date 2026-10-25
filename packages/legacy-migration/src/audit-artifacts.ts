import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

import type { ApprovalBundle } from './migration-guards.ts';
import { sha256, stableJson, type SourceEvidence } from './source-evidence.ts';
import type { ExceptionArtifact } from './exception-contract.ts';
import {
  assertNoBlockingDispositions,
  buildSourceDispositions,
  dispositionLedgerSha256,
} from './dispositions.ts';

type Client = InstanceType<typeof pg.Client>;

export const AUDIT_FILE_COLUMNS = {
  writes_sha256: 'writes.ndjson',
  dispositions_sha256: 'dispositions.ndjson',
  audit_exceptions_sha256: 'exceptions.ndjson',
  target_after_sha256: 'target-after.json',
  reconciliation_sha256: 'reconciliation.json',
  run_report_sha256: 'run.json',
} as const;

function identifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error(`Unsafe target table identifier ${value}`);
  return `"${value}"`;
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${stableJson(value)}\n`);
}

function ndjsonBytes(values: unknown[]) {
  return Buffer.from(`${values.map((value) => stableJson(value)).join('\n')}\n`);
}

/**
 * Rebuild the complete audit set from the durable target, the recaptured
 * source evidence, and checksum-bound approval inputs. No process-local import state
 * is required, so a crash immediately after COMMIT is recoverable.
 */
export async function writeDeterministicAuditArtifacts(options: {
  target: Client;
  runDirectory: string;
  durableRun: Record<string, any>;
  sourceEvidence: SourceEvidence;
  approval: ApprovalBundle;
  exceptions: ExceptionArtifact;
}) {
  const tables = (await options.target.query<{ tablename: string }>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename<>'legacy_migration_run'
    ORDER BY tablename
  `)).rows.map((row) => row.tablename);
  const counts: Record<string, number> = {};
  const writes: Array<Record<string, unknown>> = [];
  for (const table of tables) {
    const rows = (await options.target.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(t) AS row FROM ${identifier(table)} t ORDER BY to_jsonb(t)::text`,
    )).rows;
    counts[table] = rows.length;
    rows.forEach((entry, index) => writes.push({
      kind: 'row-digest', table, ordinal: index + 1,
      sha256: sha256(stableJson(entry.row)),
    }));
  }
  const objectKeys = Array.isArray(options.approval.targetObjectKeys)
    ? options.approval.targetObjectKeys.map(String).toSorted()
    : [];
  for (const key of objectKeys)
    writes.push({ kind: 'approved-object', key });

  const financeTotals = (await options.target.query(`
    SELECT
      coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0)::text AS debits,
      coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0)::text AS credits,
      coalesce(sum(amount_minor) FILTER (WHERE type='payment'),0)::text AS payments,
      coalesce(sum(amount_minor) FILTER (WHERE type='discount'),0)::text AS discounts
    FROM finance_ledger_entry WHERE school_id=$1
  `, [options.durableRun.school_id])).rows[0];
  const projectionDrift = Number((await options.target.query<{ count: string }>(`
    WITH expected AS (
      SELECT school_id,admission_id,currency,max(sequence) last_sequence,
        coalesce(sum(amount_minor) FILTER (WHERE direction='debit'),0) debits,
        coalesce(sum(amount_minor) FILTER (WHERE direction='credit'),0) credits
      FROM finance_ledger_entry GROUP BY school_id,admission_id,currency
    )
    SELECT count(*)::text AS count
    FROM expected e FULL JOIN finance_admission_balance b
      USING (school_id,admission_id,currency)
    WHERE e.school_id IS NULL OR b.school_id IS NULL OR
      e.last_sequence<>b.last_sequence OR e.debits<>b.debit_total_minor OR
      e.credits<>b.credit_total_minor
  `)).rows[0]?.count ?? '0');

  const dispositions = buildSourceDispositions(options.sourceEvidence);
  assertNoBlockingDispositions(dispositions);
  const dispositionTotals = dispositions.reduce(
    (totals, entry) => ({
      source: totals.source + entry.sourceCount,
      imported: totals.imported + entry.imported,
      intentionallyOmitted:
        totals.intentionallyOmitted + entry.intentionallyOmitted,
      deferred: totals.deferred + entry.deferred,
      blocked: totals.blocked + entry.blocked,
    }),
    { source: 0, imported: 0, intentionallyOmitted: 0, deferred: 0, blocked: 0 },
  );
  const immutableRun = {
    runId: options.durableRun.run_id,
    status: options.durableRun.status,
    schoolId: options.durableRun.school_id,
    committedAt: String(options.durableRun.committed_at),
    sourceDatabaseIdentity: options.durableRun.source_database_identity,
    targetDatabaseIdentity: options.durableRun.target_database_identity,
    sourceVersion: options.durableRun.source_version,
    sourceMigrationHistorySha256: options.durableRun.source_migration_history_sha256,
    targetMigrationHistorySha256: options.durableRun.target_migration_history_sha256,
    sourceTableDigestsSha256: options.durableRun.source_table_digests_sha256,
    importerGitCommit: options.durableRun.importer_git_commit,
    importerChecksumSha256: options.durableRun.importer_checksum_sha256,
    mappingSha256: options.durableRun.mapping_sha256,
    approvalSha256: options.durableRun.approval_sha256,
    sourceManifestSha256: options.durableRun.source_manifest_sha256,
    snapshotEvidenceSha256: options.durableRun.snapshot_evidence_sha256,
    exceptionsSha256: options.durableRun.exceptions_sha256,
    sourceDumpSha256: options.durableRun.source_dump_sha256,
    objectManifestSha256: options.durableRun.object_manifest_sha256,
    decisionSetSha256: options.durableRun.decision_set_sha256,
    targetS3: {
      endpoint: options.durableRun.target_s3_endpoint,
      region: options.durableRun.target_s3_region,
      bucket: options.durableRun.target_s3_bucket,
      forcePathStyle: options.durableRun.target_s3_force_path_style,
    },
    targetPostgresRuntimeIdentity: options.durableRun.target_postgres_runtime_identity,
    writerFence: options.durableRun.writer_fence,
  };
  const artifacts: Record<string, Buffer> = {
    'writes.ndjson': ndjsonBytes(writes),
    'dispositions.ndjson': ndjsonBytes(dispositions),
    'exceptions.ndjson': ndjsonBytes(options.exceptions.rebuilds),
    'target-after.json': jsonBytes({
      database: options.durableRun.target_database_identity,
      bucket: options.durableRun.target_s3_bucket,
      counts,
      objectCount: objectKeys.length,
    }),
    'reconciliation.json': jsonBytes({
      schoolId: options.durableRun.school_id,
      sourceTables: options.sourceEvidence.tables,
      targetCounts: counts,
      financeTotals,
      projectionDrift,
      objectCount: objectKeys.length,
      dispositionsSha256: dispositionLedgerSha256(dispositions),
      dispositionTotals,
      dispositionFamilies: dispositions,
    }),
    'run.json': jsonBytes(immutableRun),
  };
  const checksums: Record<string, string> = {};
  for (const [filename, bytes] of Object.entries(artifacts)) {
    const output = path.join(options.runDirectory, filename);
    await writeFile(output, bytes, { mode: 0o600 });
    await chmod(output, 0o600);
    checksums[filename] = sha256(bytes);
  }
  return checksums;
}
