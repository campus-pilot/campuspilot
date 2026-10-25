import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  acquireMigrationAdvisoryLock,
  buildRetryEvidence,
  LEGACY_AUTH_ID_RETRY_RUN_ID,
  prepareDurableMigrationRun,
  type DurableMigrationRunInput,
} from './migration-run.ts';

const hash = (character: string) => character.repeat(64);

function input(): DurableMigrationRunInput {
  return {
    runId: LEGACY_AUTH_ID_RETRY_RUN_ID, schoolId: 'sch_n6q4pmirqg7dpct1pr8pr',
    sourceDatabaseIdentity: 'source:5432/legacy_snapshot_fixture',
    targetDatabaseIdentity: 'target:5432/campuspilot-plus', sourceVersion: 'synthetic',
    sourceMigrationHistorySha256: hash('a'), targetMigrationHistorySha256: hash('b'),
    sourceTableDigestsSha256: hash('c'), importerGitCommit: hash('d').slice(0, 40),
    importerChecksumSha256: hash('e'), mappingSha256: hash('f'), approvalSha256: hash('1'),
    sourceManifestSha256: hash('2'), snapshotEvidenceSha256: hash('3'),
    exceptionsSha256: hash('4'), sourceDumpSha256: hash('5'), objectManifestSha256: hash('6'),
    decisionSetSha256: hash('7'), targetS3Endpoint: null, targetS3Region: 'auto',
    targetS3Bucket: 'synthetic-bucket', targetS3ForcePathStyle: false,
    targetPostgresRuntimeIdentity: { systemIdentifier: 'synthetic-target' },
    writerFence: { namespace: 'campuspilot-plus', replicas: 0 },
  };
}

function failedRun(overrides: Record<string, unknown> = {}) {
  const value = input();
  return {
    run_id: value.runId, school_id: value.schoolId, status: 'failed',
    failure_stage: 'pre_transaction', failed_at: new Date('2026-10-25T09:00:00.123Z'),
    failed_at_canonical: '2026-10-25T14:30:00.123456+05:30',
    error_summary: `Invalid preserved user ID: ${'A'.repeat(32)}`,
    retry_count: 0, retry_history: [],
    source_database_identity: value.sourceDatabaseIdentity,
    target_database_identity: value.targetDatabaseIdentity, source_version: value.sourceVersion,
    source_migration_history_sha256: value.sourceMigrationHistorySha256,
    target_migration_history_sha256: hash('8'),
    source_table_digests_sha256: value.sourceTableDigestsSha256,
    importer_git_commit: hash('9').slice(0, 40), importer_checksum_sha256: hash('a'),
    mapping_sha256: value.mappingSha256, approval_sha256: hash('b'),
    source_manifest_sha256: value.sourceManifestSha256,
    snapshot_evidence_sha256: value.snapshotEvidenceSha256,
    exceptions_sha256: value.exceptionsSha256, source_dump_sha256: value.sourceDumpSha256,
    object_manifest_sha256: value.objectManifestSha256, decision_set_sha256: hash('0'),
    target_s3_endpoint: value.targetS3Endpoint, target_s3_region: value.targetS3Region,
    target_s3_bucket: value.targetS3Bucket, target_s3_force_path_style: value.targetS3ForcePathStyle,
    target_postgres_runtime_identity: value.targetPostgresRuntimeIdentity,
    writer_fence: value.writerFence, writers_disabled: true,
    committed_at: null, finalized_at: null, verification_evidence_sha256: null,
    writes_sha256: null, dispositions_sha256: null, audit_exceptions_sha256: null,
    target_after_sha256: null, reconciliation_sha256: null, run_report_sha256: null,
    ...overrides,
  };
}

describe('same-run retry gate', () => {
  it('requires the active target session to own the migration advisory lock', async () => {
    await expect(acquireMigrationAdvisoryLock({
      query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
    } as unknown as Client)).resolves.toBeUndefined();
    await expect(acquireMigrationAdvisoryLock({
      query: vi.fn(async () => ({ rows: [{ acquired: false }] })),
    } as unknown as Client)).rejects.toThrow(/holds the target advisory lock/);
  });

  it('binds the prior failure and reviewed replacement provenance', () => {
    const evidence = buildRetryEvidence({
      existing: failedRun(), input: input(), targetBusinessRows: 0,
      retriedAt: '2026-10-25T10:00:00.000Z',
    });
    expect(evidence.previousProvenance.importerChecksumSha256).toBe(hash('a'));
    expect(evidence.replacementProvenance.importerChecksumSha256).toBe(hash('e'));
    expect(evidence.previousProvenance.trackedDecisionAndDocsSha256).toBe(hash('0'));
    expect(evidence.replacementProvenance.trackedDecisionAndDocsSha256).toBe(hash('7'));
    expect(evidence.previousFailure.errorSummary).toContain('Invalid preserved user ID');
    expect(evidence.previousFailure.failedAt).toBe('2026-10-25T14:30:00.123456+05:30');
  });

  it.each([
    [{ run_id: 'different-run' }, /exact approved Prem migration run/],
    [{ school_id: 'sch_bbbbbbbbbbbbbbbbbbbbb' }, /exact approved Prem migration run/],
    [{ failure_stage: 'transaction_started' }, /not an explicitly retryable/],
    [{ committed_at: '2026-10-25T09:01:00.000Z' }, /durable effect/],
    [{ writes_sha256: hash('f') }, /durable effect/],
    [{ source_dump_sha256: hash('0') }, /changed immutable source_dump_sha256/],
    [{ writer_fence: { namespace: 'other', replicas: 0 } }, /changed immutable writer_fence/],
    [{ error_summary: 'Some other pre-transaction validation failed' }, /Only the observed legacy auth-ID/],
    [{ retry_count: 1, retry_history: [{}] }, /allowed exactly once/],
  ])('rejects unsafe failed-run state %#', (overrides, expected) => {
    expect(() => buildRetryEvidence({
      existing: failedRun(overrides), input: input(), targetBusinessRows: 0,
      retriedAt: '2026-10-25T10:00:00.000Z',
    })).toThrow(expected);
  });

  it('rejects any target business row before retry', () => {
    expect(() => buildRetryEvidence({
      existing: failedRun(), input: input(), targetBusinessRows: 1,
      retriedAt: '2026-10-25T10:00:00.000Z',
    })).toThrow(/cannot resume with 1 target business rows/);
  });

  it('atomically transitions the exact failed run back to preparing', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('FROM public.legacy_migration_run run ORDER BY'))
        return { rows: [failedRun()], rowCount: 1 };
      if (sql.includes('UPDATE public.legacy_migration_run'))
        return { rows: [{ run_id: LEGACY_AUTH_ID_RETRY_RUN_ID }], rowCount: 1 };
      return { rows: [], rowCount: null };
    });
    const result = await prepareDurableMigrationRun({
      client: { query } as unknown as Client,
      createObserver: () => ({}) as Client,
      input: input(), countTargetBusinessRows: async () => 0,
      now: () => new Date('2026-10-25T10:00:00.000Z'),
    });
    expect(result.kind).toBe('retried');
    expect(queries[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(queries.at(-1)).toBe('COMMIT');
    expect(queries.some((sql) => sql.includes("status='preparing'"))).toBe(true);
  });

  it('rolls back rather than ignoring a different durable run', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('FROM public.legacy_migration_run run ORDER BY'))
        return { rows: [failedRun({ run_id: 'other-run' })], rowCount: 1 };
      return { rows: [], rowCount: null };
    });
    await expect(prepareDurableMigrationRun({
      client: { query } as unknown as Client,
      createObserver: () => ({}) as Client,
      input: input(), countTargetBusinessRows: async () => 0,
    })).rejects.toThrow(/different durable migration run/);
    expect(queries.at(-1)).toBe('ROLLBACK');
  });

  it('preserves the primary preparation failure when ROLLBACK also fails', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.legacy_migration_run run ORDER BY'))
        return { rows: [failedRun({ run_id: 'other-run' })], rowCount: 1 };
      if (sql === 'ROLLBACK') throw new Error('rollback transport failure');
      return { rows: [], rowCount: null };
    });
    const failure = await prepareDurableMigrationRun({
      client: { query } as unknown as Client,
      createObserver: () => ({}) as Client,
      input: input(), countTargetBusinessRows: async () => 0,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toMatchObject({
      message: expect.stringMatching(/different durable migration run/),
    });
    expect((failure as AggregateError).errors[1]).toMatchObject({
      message: 'rollback transport failure',
    });
  });

  it('observes a lost COMMIT acknowledgement on a fresh connection and continues only when fully bound', async () => {
    const replacement = input();
    const existing = failedRun();
    const evidence = buildRetryEvidence({
      existing, input: replacement, targetBusinessRows: 0,
      retriedAt: '2026-10-25T10:00:00.000Z',
    });
    const prepared = failedRun({
      status: 'preparing', failure_stage: 'none', error_summary: null,
      target_migration_history_sha256: replacement.targetMigrationHistorySha256,
      importer_git_commit: replacement.importerGitCommit,
      importer_checksum_sha256: replacement.importerChecksumSha256,
      approval_sha256: replacement.approvalSha256,
      decision_set_sha256: replacement.decisionSetSha256,
      retry_count: 1, retry_history: [evidence],
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.legacy_migration_run run ORDER BY'))
        return { rows: [existing], rowCount: 1 };
      if (sql.includes('UPDATE public.legacy_migration_run'))
        return { rows: [{ run_id: replacement.runId }], rowCount: 1 };
      if (sql === 'COMMIT') throw new Error('connection lost after COMMIT');
      return { rows: [], rowCount: null };
    });
    const observer = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async () => ({ rows: [prepared], rowCount: 1 })),
      end: vi.fn(async () => undefined),
    };
    await expect(prepareDurableMigrationRun({
      client: { query } as unknown as Client,
      createObserver: () => observer as unknown as Client,
      input: replacement, countTargetBusinessRows: async () => 0,
      now: () => new Date('2026-10-25T10:00:00.000Z'),
    })).resolves.toMatchObject({ kind: 'retried' });
    expect(observer.connect).toHaveBeenCalledOnce();
    expect(observer.end).not.toHaveBeenCalled();
  });

  it('fails closed when a lost COMMIT acknowledgement cannot be observed', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.legacy_migration_run run ORDER BY'))
        return { rows: [failedRun()], rowCount: 1 };
      if (sql.includes('UPDATE public.legacy_migration_run'))
        return { rows: [{ run_id: LEGACY_AUTH_ID_RETRY_RUN_ID }], rowCount: 1 };
      if (sql === 'COMMIT') throw new Error('connection lost after COMMIT');
      return { rows: [], rowCount: null };
    });
    const observer = {
      connect: vi.fn(async () => { throw new Error('observer unavailable'); }),
      end: vi.fn(async () => undefined),
    };
    await expect(prepareDurableMigrationRun({
      client: { query } as unknown as Client,
      createObserver: () => observer as unknown as Client,
      input: input(), countTargetBusinessRows: async () => 0,
      now: () => new Date('2026-10-25T10:00:00.000Z'),
    })).rejects.toThrow(/COMMIT outcome is ambiguous/);
    expect(observer.end).toHaveBeenCalledOnce();
  });
});
