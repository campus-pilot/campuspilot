import pg from 'pg';
import { describe, expect, it } from 'vitest';

const connectionString = process.env.LEGACY_MIGRATION_TEST_TARGET_POSTGRES_URL;
const describeWithTargetPostgres = connectionString ? describe : describe.skip;
const approvedRunId = 'prem-20261025t090000z';
const approvedSchoolId = 'sch_n6q4pmirqg7dpct1pr8pr';
const oldDigest = 'a'.repeat(64);
const knownAuthError = 'Invalid preserved user ID: 1qh1ymHCIWZZuwlgW2t9J4umhakPJ36E';
const priorTargetHistory = '0e1e5e202dc7a7878c3ec51649c0c0df31dca9c37cd9a39c2fa8d05459067327';
const priorImporterCommit = 'c5f3da7548277e6fae10137e7b0b0c9069c1082c';
const priorImporterChecksum = '7943f31968482625236c8cdec9579cf9b450b1acea30b27af45e3c41a11d458d';
const priorApproval = '73e9567e59afb9a249150b082d2b0961082ddc7d336ec0e4e516789be00165cb';
const oldContract = '06dc1f56d8cf3f3527e75320d99392e21543326c3a87b3776098651512d0d814';
const faultyTargetHistory = '6b1703a90f5dea5690e95e4f479a001287e8c9fc09b57f47c69a976462388e04';
const faultyImporterCommit = '76debfaaf77ef8e71c2cb0892920e5d9809e5db7';
const faultyImporterChecksum = '49ca2e792dde48d002095065c11795b79f6cd043b435b667c198cf6fff7fc1a4';
const faultyApproval = '62bacb2466c46eb99c114a9bc6dcc07cd7db37b82948d1f810ab6e98eb70e605';
const faultyContract = 'fd23a0ae59e5840e4896a3e6edc08a518ac5ccea0ff795441a0fc44a472164b4';
const templateError = "Cannot read properties of undefined (reading 'byteLength')";
const recoveredTargetHistory = 'b'.repeat(64);
const recoveredImporterCommit = 'b'.repeat(40);
const recoveredImporterChecksum = 'c'.repeat(64);
const recoveredApproval = 'd'.repeat(64);
const recoveredContract = 'e'.repeat(64);

function knownFirstRetryEvidence(options: {
  recoveryKind?: string;
  previousApproval?: string;
  retriedAt?: string;
} = {}) {
  return {
    ...(options.recoveryKind ? { recoveryKind: options.recoveryKind } : {}),
    retriedAt: options.retriedAt ?? '2026-10-25T10:00:55.651Z',
    previousFailure: {
      failedAt: '2026-10-25T09:31:27.709568+00:00',
      errorSummary: knownAuthError,
    },
    previousProvenance: {
      targetMigrationHistorySha256: priorTargetHistory,
      importerGitCommit: priorImporterCommit,
      importerChecksumSha256: priorImporterChecksum,
      approvalSha256: options.previousApproval ?? priorApproval,
      trackedDecisionAndDocsSha256: oldContract,
    },
    replacementProvenance: {
      targetMigrationHistorySha256: faultyTargetHistory,
      importerGitCommit: faultyImporterCommit,
      importerChecksumSha256: faultyImporterChecksum,
      approvalSha256: faultyApproval,
      trackedDecisionAndDocsSha256: faultyContract,
    },
  };
}

function assertFixtureDatabase(value: string): void {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^campuspilot_migration_fixture(?:_|$)/.test(database)) {
    throw new Error(
      'LEGACY_MIGRATION_TEST_TARGET_POSTGRES_URL must select an isolated campuspilot_migration_fixture database',
    );
  }
}

async function seedFailedRun(client: pg.Client, runId: string, schoolId: string) {
  await client.query(`
    INSERT INTO public.legacy_migration_run (
      run_id,school_id,status,source_database_identity,target_database_identity,source_version,
      source_migration_history_sha256,target_migration_history_sha256,source_table_digests_sha256,
      importer_git_commit,importer_checksum_sha256,mapping_sha256,approval_sha256,
      source_manifest_sha256,snapshot_evidence_sha256,exceptions_sha256,source_dump_sha256,
      object_manifest_sha256,decision_set_sha256,target_s3_region,target_s3_bucket,
      target_s3_force_path_style,target_postgres_runtime_identity,writer_fence,writers_disabled
    ) VALUES ($1,$2,'preparing','fixture-source','fixture-target','fixture',
      $3,$4,$3,$5,$6,$3,$7,$3,$3,$3,$3,$3,$8,
      'auto','fixture-bucket',false,'{}'::jsonb,'{}'::jsonb,true)
  `, [runId, schoolId, oldDigest, priorTargetHistory, priorImporterCommit,
    priorImporterChecksum, priorApproval, oldContract]);
  await client.query(`
    UPDATE public.legacy_migration_run
    SET status='failed',failure_stage='pre_transaction',
      failed_at='2026-10-25 09:31:27.709568+00'::timestamptz,
      error_summary=$2,updated_at=now()
    WHERE run_id=$1
  `, [runId, knownAuthError]);
}

async function retryFailedRun(
  client: pg.Client,
  runId: string,
  replacementContractEvidence = faultyContract,
  retriedAt = '2026-10-25T10:00:55.651Z',
) {
  const prior = (await client.query<Record<string, string>>(`
    SELECT *,to_jsonb(failed_at)#>>'{}' AS failed_at_canonical
    FROM public.legacy_migration_run WHERE run_id=$1
  `, [runId])).rows[0]!;
  const evidence = {
    retriedAt,
    previousFailure: {
      failedAt: prior.failed_at_canonical,
      errorSummary: prior.error_summary,
    },
    previousProvenance: {
      targetMigrationHistorySha256: prior.target_migration_history_sha256,
      importerGitCommit: prior.importer_git_commit,
      importerChecksumSha256: prior.importer_checksum_sha256,
      approvalSha256: prior.approval_sha256,
      trackedDecisionAndDocsSha256: prior.decision_set_sha256,
    },
    replacementProvenance: {
      targetMigrationHistorySha256: faultyTargetHistory,
      importerGitCommit: faultyImporterCommit,
      importerChecksumSha256: faultyImporterChecksum,
      approvalSha256: faultyApproval,
      trackedDecisionAndDocsSha256: replacementContractEvidence,
    },
  };
  return client.query(`
    UPDATE public.legacy_migration_run
    SET status='preparing',failure_stage='none',target_migration_history_sha256=$2,
      importer_git_commit=$3,importer_checksum_sha256=$4,approval_sha256=$5,
      decision_set_sha256=$6,retry_count=1,retry_history=jsonb_build_array($7::jsonb),
      updated_at=$8::timestamptz,error_summary=NULL
    WHERE run_id=$1
    RETURNING status,failure_stage,retry_count,decision_set_sha256
  `, [runId, faultyTargetHistory, faultyImporterCommit, faultyImporterChecksum,
    faultyApproval, faultyContract, JSON.stringify(evidence), retriedAt]);
}

async function failOnTemplateByteSize(client: pg.Client, runId: string) {
  return client.query(`
    UPDATE public.legacy_migration_run
    SET status='failed',failure_stage='transaction_started',error_summary=$2,
      updated_at='2026-10-25 10:01:03.478112+00'::timestamptz
    WHERE run_id=$1
  `, [runId, templateError]);
}

async function seedTemplateFailureWithHistory(
  client: pg.Client,
  firstRetry: unknown,
  updatedAt = '2026-10-25 10:01:03.478112+00',
) {
  await client.query(`
    INSERT INTO public.legacy_migration_run (
      run_id,school_id,status,source_database_identity,target_database_identity,source_version,
      source_migration_history_sha256,target_migration_history_sha256,source_table_digests_sha256,
      importer_git_commit,importer_checksum_sha256,mapping_sha256,approval_sha256,
      source_manifest_sha256,snapshot_evidence_sha256,exceptions_sha256,source_dump_sha256,
      object_manifest_sha256,decision_set_sha256,target_s3_region,target_s3_bucket,
      target_s3_force_path_style,target_postgres_runtime_identity,writer_fence,writers_disabled,
      failure_stage,failed_at,error_summary,retry_count,retry_history,updated_at
    ) VALUES ($1,$2,'failed','fixture-source','fixture-target','fixture',
      $3,$4,$3,$5,$6,$3,$7,$3,$3,$3,$3,$3,$8,
      'auto','fixture-bucket',false,'{}'::jsonb,'{}'::jsonb,true,
      'transaction_started','2026-10-25 09:31:27.709568+00'::timestamptz,$9,1,
      jsonb_build_array($10::jsonb),$11::timestamptz)
  `, [approvedRunId, approvedSchoolId, oldDigest, faultyTargetHistory,
    faultyImporterCommit, faultyImporterChecksum, faultyApproval, faultyContract,
    templateError, JSON.stringify(firstRetry), updatedAt]);
}

async function recoverTemplateByteSize(
  client: pg.Client,
  runId: string,
  retriedAt = '2026-10-25T10:30:00.765432Z',
  extraTopLevel: Record<string, unknown> = {},
  previousFailureExtra: Record<string, unknown> = {},
) {
  const prior = (await client.query<Record<string, string>>(`
    SELECT *,to_jsonb(updated_at)#>>'{}' AS updated_at_canonical
    FROM public.legacy_migration_run WHERE run_id=$1
  `, [runId])).rows[0]!;
  const evidence = {
    recoveryKind: 'template-byte-size-v1',
    retriedAt,
    previousFailure: {
      failedAt: prior.updated_at_canonical,
      errorSummary: prior.error_summary,
      ...previousFailureExtra,
    },
    previousProvenance: {
      targetMigrationHistorySha256: prior.target_migration_history_sha256,
      importerGitCommit: prior.importer_git_commit,
      importerChecksumSha256: prior.importer_checksum_sha256,
      approvalSha256: prior.approval_sha256,
      trackedDecisionAndDocsSha256: prior.decision_set_sha256,
    },
    replacementProvenance: {
      targetMigrationHistorySha256: recoveredTargetHistory,
      importerGitCommit: recoveredImporterCommit,
      importerChecksumSha256: recoveredImporterChecksum,
      approvalSha256: recoveredApproval,
      trackedDecisionAndDocsSha256: recoveredContract,
    },
    ...extraTopLevel,
  };
  return client.query(`
    UPDATE public.legacy_migration_run
    SET status='preparing',failure_stage='none',target_migration_history_sha256=$2,
      importer_git_commit=$3,importer_checksum_sha256=$4,approval_sha256=$5,
      decision_set_sha256=$6,retry_count=retry_count+1,
      retry_history=retry_history || jsonb_build_array($7::jsonb),
      updated_at=$8::timestamptz,error_summary=NULL
    WHERE run_id=$1
    RETURNING status,failure_stage,retry_count,retry_history
  `, [runId, recoveredTargetHistory, recoveredImporterCommit, recoveredImporterChecksum,
    recoveredApproval, recoveredContract, JSON.stringify(evidence), retriedAt]);
}

describeWithTargetPostgres('durable migration run guard on PostgreSQL 17', () => {
  it('executes both reviewed recoveries and rejects scope, evidence, row, and third-retry bypasses', async () => {
    assertFixtureDatabase(connectionString!);
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const version = await client.query<{ server_version_num: string }>('SHOW server_version_num');
      expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(170_000);
      expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(180_000);
      await client.query('BEGIN');

      await client.query('SAVEPOINT failed_summary');
      await seedFailedRun(client, approvedRunId, approvedSchoolId);
      await expect(client.query(`
        UPDATE public.legacy_migration_run SET error_summary=$2 WHERE run_id=$1
      `, [approvedRunId, `Invalid preserved user ID: ${'B'.repeat(32)}`])).rejects.toThrow(
        /error summary is immutable/,
      );
      await client.query('ROLLBACK TO SAVEPOINT failed_summary');

      await client.query('SAVEPOINT nonempty_first_retry');
      await client.query('CREATE TABLE public.recovery_probe (id integer PRIMARY KEY)');
      await client.query('INSERT INTO public.recovery_probe (id) VALUES (1)');
      await seedFailedRun(client, approvedRunId, approvedSchoolId);
      await expect(retryFailedRun(client, approvedRunId)).rejects.toThrow(
        /requires every target business table to remain empty/,
      );
      await client.query('ROLLBACK TO SAVEPOINT nonempty_first_retry');

      await client.query('SAVEPOINT wrong_run');
      await seedFailedRun(client, 'prem-other-run', approvedSchoolId);
      await expect(retryFailedRun(client, 'prem-other-run')).rejects.toThrow(
        /safe retry requirements/,
      );
      await client.query('ROLLBACK TO SAVEPOINT wrong_run');

      await client.query('SAVEPOINT wrong_school');
      await seedFailedRun(client, approvedRunId, 'sch_bbbbbbbbbbbbbbbbbbbbb');
      await expect(retryFailedRun(client, approvedRunId)).rejects.toThrow(
        /safe retry requirements/,
      );
      await client.query('ROLLBACK TO SAVEPOINT wrong_school');

      await client.query('SAVEPOINT wrong_contract');
      await seedFailedRun(client, approvedRunId, approvedSchoolId);
      await expect(retryFailedRun(client, approvedRunId, 'c'.repeat(64))).rejects.toThrow(
        /does not bind old and replacement provenance/,
      );
      await client.query('ROLLBACK TO SAVEPOINT wrong_contract');

      await client.query('SAVEPOINT non_monotonic_first_retry');
      await seedFailedRun(client, approvedRunId, approvedSchoolId);
      await expect(retryFailedRun(
        client,
        approvedRunId,
        faultyContract,
        '2026-10-25T09:31:27.709568Z',
      )).rejects.toThrow(/does not bind old and replacement provenance/);
      await client.query('ROLLBACK TO SAVEPOINT non_monotonic_first_retry');

      await client.query('SAVEPOINT invalid_first_retry');
      await seedTemplateFailureWithHistory(client, knownFirstRetryEvidence({ recoveryKind: 'tampered' }));
      await expect(recoverTemplateByteSize(client, approvedRunId)).rejects.toThrow(
        /existing first retry evidence is invalid/,
      );
      await client.query('ROLLBACK TO SAVEPOINT invalid_first_retry');

      await client.query('SAVEPOINT valid_shape_wrong_prior_hash');
      await seedTemplateFailureWithHistory(client, knownFirstRetryEvidence({
        previousApproval: 'f'.repeat(64),
      }));
      await expect(recoverTemplateByteSize(client, approvedRunId)).rejects.toThrow(
        /existing first retry evidence is invalid/,
      );
      await client.query('ROLLBACK TO SAVEPOINT valid_shape_wrong_prior_hash');

      await client.query('SAVEPOINT wrong_template_failure_timestamp');
      await seedTemplateFailureWithHistory(
        client,
        knownFirstRetryEvidence(),
        '2026-10-25 10:01:03.478113+00',
      );
      await expect(recoverTemplateByteSize(client, approvedRunId)).rejects.toThrow(
        /safe retry requirements/,
      );
      await client.query('ROLLBACK TO SAVEPOINT wrong_template_failure_timestamp');

      await seedFailedRun(client, approvedRunId, approvedSchoolId);
      const retry = await retryFailedRun(client, approvedRunId);
      expect(retry.rows[0]).toMatchObject({
        status: 'preparing',
        failure_stage: 'none',
        retry_count: 1,
        decision_set_sha256: faultyContract,
      });

      await client.query('SAVEPOINT wrong_template_error');
      await client.query(`
        UPDATE public.legacy_migration_run
        SET status='failed',failure_stage='transaction_started',error_summary=$2
        WHERE run_id=$1
      `, [approvedRunId, 'A different rolled-back transaction failure']);
      await expect(recoverTemplateByteSize(client, approvedRunId)).rejects.toThrow(
        /safe retry requirements/,
      );
      await client.query('ROLLBACK TO SAVEPOINT wrong_template_error');

      await failOnTemplateByteSize(client, approvedRunId);

      await client.query('SAVEPOINT mutate_failed_timestamp');
      await expect(client.query(`
        UPDATE public.legacy_migration_run
        SET updated_at=updated_at + interval '1 microsecond'
        WHERE run_id=$1
      `, [approvedRunId])).rejects.toThrow(/failed-state timestamp is immutable/);
      await client.query('ROLLBACK TO SAVEPOINT mutate_failed_timestamp');

      await client.query('SAVEPOINT non_monotonic_second_retry');
      await expect(recoverTemplateByteSize(
        client,
        approvedRunId,
        '2026-10-25T10:01:03.478112Z',
      )).rejects.toThrow(/does not bind old and replacement provenance/);
      await client.query('ROLLBACK TO SAVEPOINT non_monotonic_second_retry');

      await client.query('SAVEPOINT extra_second_retry_top_level');
      await expect(recoverTemplateByteSize(
        client,
        approvedRunId,
        '2026-10-25T10:30:00.765432Z',
        { unexpected: true },
      )).rejects.toThrow(/does not bind old and replacement provenance/);
      await client.query('ROLLBACK TO SAVEPOINT extra_second_retry_top_level');

      await client.query('SAVEPOINT extra_second_retry_nested');
      await expect(recoverTemplateByteSize(
        client,
        approvedRunId,
        '2026-10-25T10:30:00.765432Z',
        {},
        { unexpected: true },
      )).rejects.toThrow(/does not bind old and replacement provenance/);
      await client.query('ROLLBACK TO SAVEPOINT extra_second_retry_nested');

      await client.query('SAVEPOINT nonempty_target');
      await client.query('CREATE TABLE public.recovery_probe (id integer PRIMARY KEY)');
      await client.query('INSERT INTO public.recovery_probe (id) VALUES (1)');
      await expect(recoverTemplateByteSize(client, approvedRunId)).rejects.toThrow(
        /requires every target business table to remain empty/,
      );
      await client.query('ROLLBACK TO SAVEPOINT nonempty_target');

      const recovery = await recoverTemplateByteSize(client, approvedRunId);
      expect(recovery.rows[0]).toMatchObject({
        status: 'preparing',
        failure_stage: 'none',
        retry_count: 2,
      });
      expect(recovery.rows[0].retry_history).toHaveLength(2);
      expect(recovery.rows[0].retry_history[1]).toMatchObject({
        recoveryKind: 'template-byte-size-v1',
        previousFailure: { errorSummary: templateError },
      });

      await failOnTemplateByteSize(client, approvedRunId);
      await expect(recoverTemplateByteSize(client, approvedRunId)).rejects.toThrow(
        /safe retry requirements/,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
