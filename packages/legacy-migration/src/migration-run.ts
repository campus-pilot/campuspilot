import { createHash } from 'node:crypto';

import type { Client } from 'pg';

import { APPROVED_SCHOOL_ID } from './migration-guards.ts';

export const LEGACY_AUTH_ID_RETRY_RUN_ID = 'prem-20261025t090000z';
export const TEMPLATE_BYTE_SIZE_RETRY_ERROR =
  "Cannot read properties of undefined (reading 'byteLength')";
export const TEMPLATE_BYTE_SIZE_FAILURE_UPDATED_AT =
  '2026-10-25T10:01:03.478112+00:00';

/**
 * Exact executable provenance of the rolled-back template byte-size failure.
 * This prevents unrelated future transaction failures from using its recovery.
 */
export const TEMPLATE_BYTE_SIZE_FAILURE_PROVENANCE = {
  targetMigrationHistorySha256:
    '6b1703a90f5dea5690e95e4f479a001287e8c9fc09b57f47c69a976462388e04',
  importerGitCommit: '76debfaaf77ef8e71c2cb0892920e5d9809e5db7',
  importerChecksumSha256:
    '49ca2e792dde48d002095065c11795b79f6cd043b435b667c198cf6fff7fc1a4',
  approvalSha256:
    '62bacb2466c46eb99c114a9bc6dcc07cd7db37b82948d1f810ab6e98eb70e605',
  trackedDecisionAndDocsSha256:
    'fd23a0ae59e5840e4896a3e6edc08a518ac5ccea0ff795441a0fc44a472164b4',
} as const;

/** Exact sanitized binding for the immutable first recovery record. */
export const FIRST_RETRY_EVIDENCE_BINDING = {
  retriedAt: '2026-10-25T10:00:55.651Z',
  previousFailure: {
    failedAt: '2026-10-25T09:31:27.709568+00:00',
    errorSummarySha256:
      '969b6935bc2f6041844eecf742c65ba2ff2e50b3ca468439e11f34d776658173',
  },
  previousProvenance: {
    targetMigrationHistorySha256:
      '0e1e5e202dc7a7878c3ec51649c0c0df31dca9c37cd9a39c2fa8d05459067327',
    importerGitCommit: 'c5f3da7548277e6fae10137e7b0b0c9069c1082c',
    importerChecksumSha256:
      '7943f31968482625236c8cdec9579cf9b450b1acea30b27af45e3c41a11d458d',
    approvalSha256:
      '73e9567e59afb9a249150b082d2b0961082ddc7d336ec0e4e516789be00165cb',
    trackedDecisionAndDocsSha256:
      '06dc1f56d8cf3f3527e75320d99392e21543326c3a87b3776098651512d0d814',
  },
  replacementProvenance: TEMPLATE_BYTE_SIZE_FAILURE_PROVENANCE,
} as const;

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
  updated_at_canonical: string | null;
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

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

function existingExecutableProvenance(existing: DurableRunRow) {
  return {
    targetMigrationHistorySha256: existing.target_migration_history_sha256,
    importerGitCommit: existing.importer_git_commit,
    importerChecksumSha256: existing.importer_checksum_sha256,
    approvalSha256: existing.approval_sha256,
    trackedDecisionAndDocsSha256: existing.decision_set_sha256,
  };
}

function replacementExecutableProvenance(input: DurableMigrationRunInput) {
  return {
    targetMigrationHistorySha256: input.targetMigrationHistorySha256,
    importerGitCommit: input.importerGitCommit,
    importerChecksumSha256: input.importerChecksumSha256,
    approvalSha256: input.approvalSha256,
    trackedDecisionAndDocsSha256: input.decisionSetSha256,
  };
}

/** Validate the append-only auth-ID retry record before permitting recovery two. */
function assertFirstRetryEvidence(existing: DurableRunRow) {
  const history = existing.retry_history as Array<Record<string, any>>;
  const first = history[0];
  const firstRetriedAt = typeof first?.retriedAt === 'string' ? Date.parse(first.retriedAt) : NaN;
  const originalFailedAt = Date.parse(String(existing.failed_at_canonical ?? ''));
  const templateFailedAt = Date.parse(String(existing.updated_at_canonical ?? ''));
  const errorSummary = String(first?.previousFailure?.errorSummary ?? '');
  const normalizedPreviousFailure = first?.previousFailure
    ? { ...first.previousFailure }
    : {};
  delete normalizedPreviousFailure.errorSummary;
  const normalizedFirst = first ? {
    ...first,
    previousFailure: {
      ...normalizedPreviousFailure,
      errorSummarySha256: sha256Text(errorSummary),
    },
  } : null;
  if (!first || !RETRYABLE_LEGACY_AUTH_ID_FAILURE.test(errorSummary) ||
    stableJson(normalizedFirst) !== stableJson(FIRST_RETRY_EVIDENCE_BINDING) ||
    first.previousFailure?.failedAt !== existing.failed_at_canonical ||
    Number.isNaN(firstRetriedAt) || firstRetriedAt <= originalFailedAt || firstRetriedAt >= templateFailedAt ||
    stableJson(first.replacementProvenance) !== stableJson(existingExecutableProvenance(existing))) {
    throw new Error('Existing first retry evidence is invalid for template byte-size recovery');
  }
}

/**
 * Validate one of the two release-scoped recoveries for the exact Prem run.
 * Both require an empty target, no durable effects, and unchanged source/runtime
 * facts. Recovery two additionally binds the rolled-back template byte-size
 * failure and the complete first retry record.
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
    throw new Error('Migration recovery is limited to the exact approved Prem migration run');
  if (existing.run_id !== input.runId)
    throw new Error('A failed migration run may only resume with the same runId');
  if (existing.status !== 'failed')
    throw new Error('Migration run is not failed');
  if (!existing.failed_at || !existing.error_summary)
    throw new Error('Failed migration run is missing its durable failure evidence');
  if (!existing.failed_at_canonical)
    throw new Error('Failed migration run is missing its lossless database timestamp evidence');
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

  let failedAt: string;
  let recoveryKind: 'template-byte-size-v1' | undefined;
  if (existing.failure_stage === 'pre_transaction' &&
    Number(existing.retry_count) === 0 && existing.retry_history.length === 0) {
    if (!RETRYABLE_LEGACY_AUTH_ID_FAILURE.test(existing.error_summary))
      throw new Error('Only the observed legacy auth-ID validation failure is retryable');
    failedAt = existing.failed_at_canonical;
    recoveryKind = undefined;
  } else if (existing.failure_stage === 'transaction_started' &&
    Number(existing.retry_count) === 1 && existing.retry_history.length === 1) {
    if (existing.error_summary !== TEMPLATE_BYTE_SIZE_RETRY_ERROR)
      throw new Error('Only the exact rolled-back template byte-size failure is recoverable');
    if (!existing.updated_at_canonical)
      throw new Error('Template byte-size failure is missing its lossless database timestamp evidence');
    if (existing.updated_at_canonical !== TEMPLATE_BYTE_SIZE_FAILURE_UPDATED_AT)
      throw new Error('Template byte-size failure timestamp does not match the observed failure');
    if (stableJson(existingExecutableProvenance(existing)) !==
      stableJson(TEMPLATE_BYTE_SIZE_FAILURE_PROVENANCE))
      throw new Error('Template byte-size failure does not match the known faulty importer provenance');
    assertFirstRetryEvidence(existing);
    failedAt = existing.updated_at_canonical;
    recoveryKind = 'template-byte-size-v1';
  } else {
    throw new Error('Migration run is not in an explicitly recoverable failure state');
  }

  const retryTime = Date.parse(retriedAt);
  const currentFailureTime = Date.parse(failedAt);
  const firstRetryTime = recoveryKind ? Date.parse(FIRST_RETRY_EVIDENCE_BINDING.retriedAt) : -Infinity;
  if (Number.isNaN(retryTime) || retryTime <= currentFailureTime || retryTime <= firstRetryTime)
    throw new Error('Migration recovery timestamp must be strictly after its failure and prior retry');

  return {
    ...(recoveryKind ? { recoveryKind } : {}),
    retriedAt,
    previousFailure: {
      failedAt,
      errorSummary: existing.error_summary,
    },
    previousProvenance: existingExecutableProvenance(existing),
    replacementProvenance: replacementExecutableProvenance(input),
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
      SELECT run.*,to_jsonb(run.failed_at)#>>'{}' AS failed_at_canonical,
        to_jsonb(run.updated_at)#>>'{}' AS updated_at_canonical
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
      `SELECT run.*,to_jsonb(run.failed_at)#>>'{}' AS failed_at_canonical,
        to_jsonb(run.updated_at)#>>'{}' AS updated_at_canonical
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
      WHERE run_id=$1 AND status='failed' AND (
        (failure_stage='pre_transaction' AND retry_count=0) OR
        (failure_stage='transaction_started' AND retry_count=1 AND error_summary=$9)
      )
      RETURNING run_id
    `, [
      input.runId, input.targetMigrationHistorySha256, input.importerGitCommit,
      input.importerChecksumSha256, input.approvalSha256, input.decisionSetSha256,
      evidence.retriedAt,
      JSON.stringify(evidence),
      TEMPLATE_BYTE_SIZE_RETRY_ERROR,
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
