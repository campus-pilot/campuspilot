import pg from 'pg';
import { describe, expect, it } from 'vitest';

const connectionString = process.env.LEGACY_MIGRATION_TEST_TARGET_POSTGRES_URL;
const describeWithTargetPostgres = connectionString ? describe : describe.skip;
const approvedRunId = 'prem-20261025t090000z';
const approvedSchoolId = 'sch_n6q4pmirqg7dpct1pr8pr';
const oldDigest = 'a'.repeat(64);
const newDigest = 'b'.repeat(64);
const oldContract = '0'.repeat(64);
const newContract = '7'.repeat(64);

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
      $3,$3,$3,$4,$3,$3,$3,$3,$3,$3,$3,$3,$5,
      'auto','fixture-bucket',false,'{}'::jsonb,'{}'::jsonb,true)
  `, [runId, schoolId, oldDigest, 'a'.repeat(40), oldContract]);
  await client.query(`
    UPDATE public.legacy_migration_run
    SET status='failed',failure_stage='pre_transaction',
      failed_at='2026-10-25 09:00:00.123456+00'::timestamptz,
      error_summary=$2,updated_at=now()
    WHERE run_id=$1
  `, [runId, `Invalid preserved user ID: ${'A'.repeat(32)}`]);
}

async function retryFailedRun(
  client: pg.Client,
  runId: string,
  replacementContractEvidence = newContract,
) {
  const prior = (await client.query<Record<string, string>>(`
    SELECT *,to_jsonb(failed_at)#>>'{}' AS failed_at_canonical
    FROM public.legacy_migration_run WHERE run_id=$1
  `, [runId])).rows[0]!;
  const retriedAt = '2026-10-25T10:00:00.654321Z';
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
      targetMigrationHistorySha256: newDigest,
      importerGitCommit: 'b'.repeat(40),
      importerChecksumSha256: newDigest,
      approvalSha256: newDigest,
      trackedDecisionAndDocsSha256: replacementContractEvidence,
    },
  };
  return client.query(`
    UPDATE public.legacy_migration_run
    SET status='preparing',failure_stage='none',target_migration_history_sha256=$2,
      importer_git_commit=$3,importer_checksum_sha256=$2,approval_sha256=$2,
      decision_set_sha256=$4,retry_count=1,retry_history=jsonb_build_array($5::jsonb),
      updated_at=$6::timestamptz,error_summary=NULL
    WHERE run_id=$1
    RETURNING status,failure_stage,retry_count,decision_set_sha256
  `, [runId, newDigest, 'b'.repeat(40), newContract, JSON.stringify(evidence), retriedAt]);
}

describeWithTargetPostgres('durable migration run guard on PostgreSQL 17', () => {
  it('executes the sole successful retry and rejects every scope/evidence mutation', async () => {
    assertFixtureDatabase(connectionString!);
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await client.query('BEGIN');

      await client.query('SAVEPOINT failed_summary');
      await seedFailedRun(client, approvedRunId, approvedSchoolId);
      await expect(client.query(`
        UPDATE public.legacy_migration_run SET error_summary=$2 WHERE run_id=$1
      `, [approvedRunId, `Invalid preserved user ID: ${'B'.repeat(32)}`])).rejects.toThrow(
        /error summary is immutable/,
      );
      await client.query('ROLLBACK TO SAVEPOINT failed_summary');

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

      await seedFailedRun(client, approvedRunId, approvedSchoolId);
      const retry = await retryFailedRun(client, approvedRunId);
      expect(retry.rows[0]).toMatchObject({
        status: 'preparing',
        failure_stage: 'none',
        retry_count: 1,
        decision_set_sha256: newContract,
      });
      await client.query(`
        UPDATE public.legacy_migration_run
        SET status='failed',failure_stage='pre_transaction',error_summary=$2
        WHERE run_id=$1
      `, [approvedRunId, `Invalid preserved user ID: ${'A'.repeat(32)}`]);
      await expect(retryFailedRun(client, approvedRunId)).rejects.toThrow(
        /safe retry requirements/,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
