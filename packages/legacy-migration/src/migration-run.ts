import type { Client } from 'pg';

import { APPROVED_SCHOOL_ID } from './migration-guards.ts';

export const LEGACY_AUTH_ID_RETRY_RUN_ID = 'prem-20261025t090000z';

export type DurableMigrationRunInput = {
  runId: string;
  schoolId: string;
  sourceDatabaseIdentity: string;
  targetDatabaseIdentity: string;
  sourceVersion: string;
  sourceMigrationHistorySha256: string;
  targetMigrationHistorySha256: string;
  sourceTableDigestsSha256: string;
  importerGitCommit: string;
  importerChecksumSha256: string;
  mappingSha256: string;
  approvalSha256: string;
  sourceManifestSha256: string;
  snapshotEvidenceSha256: string;
  exceptionsSha256: string;
  sourceDumpSha256: string;
  objectManifestSha256: string;
  decisionSetSha256: string;
  targetS3Endpoint: string | null;
  targetS3Region: string;
  targetS3Bucket: string;
  targetS3ForcePathStyle: boolean;
  targetPostgresRuntimeIdentity: unknown;
  writerFence: unknown;
};

type DurableRunRow = Record<string, unknown> & {
  run_id: string;
  status: string;
  failure_stage: string;
  failed_at: Date | string | null;
  failed_at_canonical: string | null;
  error_summary: string | null;
  retry_count: number;
  retry_history: unknown;
};

const RETRYABLE_LEGACY_AUTH_ID_FAILURE =
  /^Invalid preserved (user|account) ID: [A-Za-z0-9]{32}$/;

const immutableRetryFields = [
  'run_id', 'school_id', 'source_database_identity', 'target_database_identity',
  'source_version', 'source_migration_history_sha256', 'source_table_digests_sha256',
  'mapping_sha256', 'source_manifest_sha256', 'snapshot_evidence_sha256',
  'exceptions_sha256', 'source_dump_sha256', 'object_manifest_sha256',
  'target_s3_endpoint', 'target_s3_region',
  'target_s3_bucket', 'target_s3_force_path_style',
  'target_postgres_runtime_identity', 'writer_fence', 'writers_disabled',
] as const;

const effectFields = [
  'committed_at', 'finalized_at', 'verification_evidence_sha256', 'writes_sha256',
  'dispositions_sha256', 'audit_exceptions_sha256', 'target_after_sha256',
  'reconciliation_sha256', 'run_report_sha256',
] as const;

/** Hold the process-wide target migration mutex on the active DB session. */
export async function acquireMigrationAdvisoryLock(client: Client) {
  const result = await client.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock(hashtextextended('campuspilot-legacy-migration',0)) AS acquired`,
  );
  if (!result.rows[0]?.acquired)
    throw new Error('Another legacy migration process holds the target advisory lock');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function inputAsRow(input: DurableMigrationRunInput): Record<string, unknown> {
  return {
    run_id: input.runId,
    school_id: input.schoolId,
    source_database_identity: input.sourceDatabaseIdentity,
    target_database_identity: input.targetDatabaseIdentity,
    source_version: input.sourceVersion,
    source_migration_history_sha256: input.sourceMigrationHistorySha256,
    target_migration_history_sha256: input.targetMigrationHistorySha256,
    source_table_digests_sha256: input.sourceTableDigestsSha256,
    importer_git_commit: input.importerGitCommit,
    importer_checksum_sha256: input.importerChecksumSha256,
    mapping_sha256: input.mappingSha256,
    approval_sha256: input.approvalSha256,
    source_manifest_sha256: input.sourceManifestSha256,
    snapshot_evidence_sha256: input.snapshotEvidenceSha256,
    exceptions_sha256: input.exceptionsSha256,
    source_dump_sha256: input.sourceDumpSha256,
    object_manifest_sha256: input.objectManifestSha256,
    decision_set_sha256: input.decisionSetSha256,
    target_s3_endpoint: input.targetS3Endpoint,
    target_s3_region: input.targetS3Region,
    target_s3_bucket: input.targetS3Bucket,
    target_s3_force_path_style: input.targetS3ForcePathStyle,
    target_postgres_runtime_identity: input.targetPostgresRuntimeIdentity,
    writer_fence: input.writerFence,
    writers_disabled: true,
  };
}

/**
 * Validate the only supported retry: the exact failed run, before its business
 * transaction started, with no target effects and unchanged source/runtime
 * facts. Importer, approval, and target-history hashes may change because the
 * reviewed retry fix itself changes those artifacts.
 */
export function buildRetryEvidence(options: {
  existing: DurableRunRow;
  input: DurableMigrationRunInput;
  targetBusinessRows: number;
  retriedAt: string;
}) {
  const { existing, input, targetBusinessRows, retriedAt } = options;
  if (existing.run_id !== LEGACY_AUTH_ID_RETRY_RUN_ID ||
    input.runId !== LEGACY_AUTH_ID_RETRY_RUN_ID ||
    existing.school_id !== APPROVED_SCHOOL_ID || input.schoolId !== APPROVED_SCHOOL_ID)
    throw new Error('Legacy auth-ID retry is limited to the exact approved Prem migration run');
  if (existing.run_id !== input.runId)
    throw new Error('A failed migration run may only resume with the same runId');
  if (existing.status !== 'failed' || existing.failure_stage !== 'pre_transaction')
    throw new Error('Migration run is not an explicitly retryable pre-transaction failure');
  if (!existing.failed_at || !existing.error_summary)
    throw new Error('Failed migration run is missing its durable failure evidence');
  if (!existing.failed_at_canonical)
    throw new Error('Failed migration run is missing its lossless database timestamp evidence');
  if (!RETRYABLE_LEGACY_AUTH_ID_FAILURE.test(existing.error_summary))
    throw new Error('Only the observed legacy auth-ID validation failure is retryable');
  if (targetBusinessRows !== 0)
    throw new Error(`Failed migration run cannot resume with ${targetBusinessRows} target business rows`);
  for (const field of effectFields) {
    if (existing[field] !== null)
      throw new Error(`Failed migration run has a durable effect in ${field}`);
  }

  const expected = inputAsRow(input);
  for (const field of immutableRetryFields) {
    if (stableJson(existing[field]) !== stableJson(expected[field]))
      throw new Error(`Failed migration run retry changed immutable ${field}`);
  }
  if (!Array.isArray(existing.retry_history) ||
    existing.retry_history.length !== Number(existing.retry_count))
    throw new Error('Failed migration run retry history is malformed');
  if (Number(existing.retry_count) !== 0 || existing.retry_history.length !== 0)
    throw new Error('The legacy auth-ID compatibility retry is allowed exactly once');

  return {
    retriedAt,
    previousFailure: {
      failedAt: existing.failed_at_canonical,
      errorSummary: existing.error_summary,
    },
    previousProvenance: {
      targetMigrationHistorySha256: existing.target_migration_history_sha256,
      importerGitCommit: existing.importer_git_commit,
      importerChecksumSha256: existing.importer_checksum_sha256,
      approvalSha256: existing.approval_sha256,
      trackedDecisionAndDocsSha256: existing.decision_set_sha256,
    },
    replacementProvenance: {
      targetMigrationHistorySha256: input.targetMigrationHistorySha256,
      importerGitCommit: input.importerGitCommit,
      importerChecksumSha256: input.importerChecksumSha256,
      approvalSha256: input.approvalSha256,
      trackedDecisionAndDocsSha256: input.decisionSetSha256,
    },
  };
}

function assertPreparedOutcome(
  row: DurableRunRow,
  input: DurableMigrationRunInput,
  retryCount: number,
) {
  if (row.run_id !== input.runId || row.status !== 'preparing' || row.failure_stage !== 'none')
    throw new Error('Observed durable migration run is not the expected preparing run');
  const expected = inputAsRow(input);
  for (const [field, value] of Object.entries(expected)) {
    if (stableJson(row[field]) !== stableJson(value))
      throw new Error(`Observed durable migration run changed ${field}`);
  }
  for (const field of effectFields) {
    if (row[field] !== null)
      throw new Error(`Observed durable migration run has an unexpected effect in ${field}`);
  }
  if (Number(row.retry_count) !== retryCount ||
    !Array.isArray(row.retry_history) || row.retry_history.length !== retryCount)
    throw new Error('Observed durable migration run has unexpected retry evidence');
}

async function observePreparationCommit(options: {
  createObserver: () => Client;
  input: DurableMigrationRunInput;
  retryCount: number;
}) {
  const observer = options.createObserver();
  let retainObserver = false;
  try {
    await observer.connect();
    const result = await observer.query<DurableRunRow>(`
      SELECT run.*,to_jsonb(run.failed_at)#>>'{}' AS failed_at_canonical
      FROM public.legacy_migration_run run
      WHERE run_id=$1
    `, [options.input.runId]);
    const row = result.rows[0];
    if (!row || row.status === 'failed') return undefined;
    assertPreparedOutcome(row, options.input, options.retryCount);
    retainObserver = true;
    return observer;
  } finally {
    if (!retainObserver) await observer.end().catch(() => undefined);
  }
}

async function commitPreparation(options: {
  client: Client;
  createObserver: () => Client;
  input: DurableMigrationRunInput;
  retryCount: number;
}) {
  try {
    await options.client.query('COMMIT');
    return undefined;
  } catch (commitError) {
    try {
      const observer = await observePreparationCommit(options);
      if (observer) return observer;
    } catch (observationError) {
      throw new AggregateError(
        [commitError, observationError],
        'Durable migration-run preparation COMMIT outcome is ambiguous; preserve the row for manual inspection',
      );
    }
    throw commitError;
  }
}

/** Create a new durable run or explicitly resume the same safe failed run. */
export async function prepareDurableMigrationRun(options: {
  client: Client;
  createObserver: () => Client;
  input: DurableMigrationRunInput;
  countTargetBusinessRows: () => Promise<number>;
  now?: () => Date;
}) {
  const { client, input, countTargetBusinessRows } = options;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    const existingRuns = await client.query<DurableRunRow>(
      `SELECT run.*,to_jsonb(run.failed_at)#>>'{}' AS failed_at_canonical
       FROM public.legacy_migration_run run ORDER BY run_id FOR UPDATE`,
    );
    const differentRun = existingRuns.rows.find((row) => row.run_id !== input.runId);
    if (differentRun)
      throw new Error(`Target contains a different durable migration run ${differentRun.run_id}`);
    const targetBusinessRows = await countTargetBusinessRows();
    if (targetBusinessRows !== 0)
      throw new Error(`Target contains ${targetBusinessRows} business rows before durable run preparation`);

    const existing = existingRuns.rows[0];
    if (!existing) {
      await client.query(`
        INSERT INTO public.legacy_migration_run (
          run_id,school_id,status,source_database_identity,target_database_identity,source_version,
          source_migration_history_sha256,target_migration_history_sha256,source_table_digests_sha256,importer_git_commit,
          importer_checksum_sha256,mapping_sha256,approval_sha256,source_manifest_sha256,
          snapshot_evidence_sha256,exceptions_sha256,source_dump_sha256,object_manifest_sha256,decision_set_sha256,
          target_s3_endpoint,target_s3_region,target_s3_bucket,target_s3_force_path_style,
          target_postgres_runtime_identity,writer_fence,writers_disabled
        ) VALUES ($1,$2,'preparing',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,true)
      `, [
        input.runId, input.schoolId, input.sourceDatabaseIdentity, input.targetDatabaseIdentity,
        input.sourceVersion, input.sourceMigrationHistorySha256, input.targetMigrationHistorySha256,
        input.sourceTableDigestsSha256, input.importerGitCommit, input.importerChecksumSha256,
        input.mappingSha256, input.approvalSha256, input.sourceManifestSha256,
        input.snapshotEvidenceSha256, input.exceptionsSha256, input.sourceDumpSha256,
        input.objectManifestSha256, input.decisionSetSha256, input.targetS3Endpoint,
        input.targetS3Region, input.targetS3Bucket, input.targetS3ForcePathStyle,
        input.targetPostgresRuntimeIdentity, input.writerFence,
      ]);
      const replacementClient = await commitPreparation({
        client,
        createObserver: options.createObserver,
        input,
        retryCount: 0,
      });
      return { kind: 'created' as const, replacementClient };
    }

    const evidence = buildRetryEvidence({
      existing,
      input,
      targetBusinessRows,
      retriedAt: (options.now?.() ?? new Date()).toISOString(),
    });
    const resumed = await client.query(`
      UPDATE public.legacy_migration_run
      SET status='preparing',failure_stage='none',target_migration_history_sha256=$2,
        importer_git_commit=$3,importer_checksum_sha256=$4,approval_sha256=$5,
        decision_set_sha256=$6,retry_count=retry_count+1,
        retry_history=retry_history || jsonb_build_array($8::jsonb),
        updated_at=$7::timestamptz,error_summary=NULL
      WHERE run_id=$1 AND status='failed' AND failure_stage='pre_transaction'
      RETURNING run_id
    `, [
      input.runId, input.targetMigrationHistorySha256, input.importerGitCommit,
      input.importerChecksumSha256, input.approvalSha256, input.decisionSetSha256,
      evidence.retriedAt,
      JSON.stringify(evidence),
    ]);
    if (resumed.rowCount !== 1)
      throw new Error('Failed migration run changed while preparing its retry');
    const replacementClient = await commitPreparation({
      client,
      createObserver: options.createObserver,
      input,
      retryCount: Number(existing.retry_count) + 1,
    });
    return { kind: 'retried' as const, evidence, replacementClient };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Migration-run preparation failed and its ROLLBACK also failed',
      );
    }
    throw error;
  }
}
