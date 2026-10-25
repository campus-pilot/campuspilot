import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { legacyMigrationRunTable } from '@campuspilot/db/schema/migration';
import { describe, expect, it } from 'vitest';

describe('durable migration run schema', () => {
  it('exports every lifecycle/provenance column used by the importer', () => {
    expect(getTableName(legacyMigrationRunTable)).toBe('legacy_migration_run');
    expect(Object.keys(getTableColumns(legacyMigrationRunTable))).toEqual(
      expect.arrayContaining([
        'runId', 'status', 'sourceDatabaseIdentity', 'targetDatabaseIdentity',
        'sourceMigrationHistorySha256', 'targetMigrationHistorySha256', 'sourceTableDigestsSha256',
        'mappingSha256', 'approvalSha256', 'sourceManifestSha256',
        'snapshotEvidenceSha256', 'exceptionsSha256', 'sourceDumpSha256', 'objectManifestSha256',
        'decisionSetSha256', 'writersDisabled', 'committedAt', 'finalizedAt',
        'targetPostgresRuntimeIdentity', 'writerFence', 'failedAt', 'errorSummary',
        'failureStage', 'retryCount', 'retryHistory',
        'verificationEvidenceSha256',
        'writesSha256', 'dispositionsSha256', 'auditExceptionsSha256',
        'targetAfterSha256', 'reconciliationSha256', 'runReportSha256',
      ]),
    );
  });

  it('keeps the generated SQL migration in the repository history', async () => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const sql = await readFile(path.resolve(packageRoot, '../db/src/migrations/0023_legacy-migration-run.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE "legacy_migration_run"');
    expect(sql).toContain('legacy_migration_run_status');
    const hardening = await readFile(path.resolve(packageRoot, '../db/src/migrations/0024_wise_magneto.sql'), 'utf8');
    expect(hardening).toContain('legacy_migration_run_guard');
    expect(hardening).toContain('legacy migration provenance is immutable');
    expect(hardening).toContain('invalid legacy migration status transition');
    const attestation = await readFile(path.resolve(packageRoot, '../db/src/migrations/0025_fuzzy_psynapse.sql'), 'utf8');
    expect(attestation).toContain('verification_evidence_sha256');
    expect(attestation).toContain('legacy migration verification attestation is immutable');
    const finalizedGate = await readFile(path.resolve(packageRoot, '../db/src/migrations/0026_youthful_lady_mastermind.sql'), 'utf8');
    expect(finalizedGate).toContain('verification_evidence_sha256');
    const auditGate = await readFile(path.resolve(packageRoot, '../db/src/migrations/0027_lame_rick_jones.sql'), 'utf8');
    expect(auditGate).toContain('writes_sha256');
    expect(auditGate).toContain('legacy migration audit attestations are immutable');
    expect(auditGate).toContain('legacy_migration_business_writer_guard');
    const authority = await readFile(path.resolve(packageRoot, '../db/src/migrations/0028_glorious_tag.sql'), 'utf8');
    expect(authority).toContain('target_migration_history_sha256');
    expect(authority).toContain('SECURITY DEFINER');
    expect(authority).toContain('session_user <> \'campuspilot-plus-migration\'');
    expect(authority).toContain('REVOKE ALL ON TABLE public.legacy_migration_run');
    const retryGate = await readFile(path.resolve(packageRoot, '../db/src/migrations/0029_happy_owl.sql'), 'utf8');
    expect(retryGate).toContain("failure_stage = CASE");
    expect(retryGate).toContain("OLD.failure_stage <> 'pre_transaction'");
    expect(retryGate).toContain("OLD.error_summary !~ '^Invalid preserved (user|account) ID: [A-Za-z0-9]{32}$'");
    expect(retryGate).toContain("OLD.retry_count <> 0 OR OLD.retry_history <> '[]'::jsonb");
    expect(retryGate).toContain("OLD.run_id <> 'prem-20261025t090000z'");
    expect(retryGate).toContain("OLD.school_id <> 'sch_n6q4pmirqg7dpct1pr8pr'");
    expect(retryGate).toContain("'{previousProvenance,trackedDecisionAndDocsSha256}'");
    expect(retryGate).toContain("'{replacementProvenance,trackedDecisionAndDocsSha256}'");
    expect(retryGate).toContain('legacy migration error summary is immutable outside its lifecycle transition');
    expect(retryGate).toContain("OLD.status='preparing' AND NEW.status='failed'");
    expect(retryGate).toContain("OLD.status='committed' AND NEW.status='committed'");
    expect(retryGate).toContain('legacy migration retry evidence does not bind old and replacement provenance');
    expect(retryGate).toContain("OLD.status='failed' AND NEW.status IN ('failed','preparing')");
    const secondRetryGate = await readFile(path.resolve(packageRoot, '../db/src/migrations/0030_dazzling_silver_sable.sql'), 'utf8');
    expect(secondRetryGate).toContain('"legacy_migration_run"."retry_count" BETWEEN 0 AND 2');
    expect(secondRetryGate).toContain('0030 recovery preflight found an unexpected durable migration row');
    expect(secondRetryGate).toContain('(SELECT count(*) FROM public.legacy_migration_run) <> 1');
    expect(secondRetryGate).toContain("run.status='failed' AND run.failure_stage='transaction_started'");
    expect(secondRetryGate).toContain("OLD.run_id <> 'prem-20261025t090000z'");
    expect(secondRetryGate).toContain("OLD.school_id <> 'sch_n6q4pmirqg7dpct1pr8pr'");
    expect(secondRetryGate).toContain("OLD.failure_stage='transaction_started' AND OLD.retry_count=1");
    expect(secondRetryGate).toContain("OLD.error_summary='Cannot read properties of undefined (reading ''byteLength'')'");
    expect(secondRetryGate).toContain("OLD.updated_at='2026-10-25 10:01:03.478112+00'::timestamptz");
    expect(secondRetryGate).toContain('legacy migration failed-state timestamp is immutable');
    expect(secondRetryGate).toContain("retry_kind := 'template-byte-size-v1'");
    expect(secondRetryGate).toContain("first_retry_evidence := OLD.retry_history -> 0");
    expect(secondRetryGate).toContain("first_retry_evidence - 'retriedAt' - 'previousFailure'");
    expect(secondRetryGate).toContain('969b6935bc2f6041844eecf742c65ba2ff2e50b3ca468439e11f34d776658173');
    expect(secondRetryGate).toContain('73e9567e59afb9a249150b082d2b0961082ddc7d336ec0e4e516789be00165cb');
    expect(secondRetryGate).toContain("(first_retry_evidence->>'retriedAt')::timestamptz <= OLD.failed_at");
    expect(secondRetryGate).toContain("(retry_evidence->>'retriedAt')::timestamptz <=");
    expect(secondRetryGate).toContain("tablename <> 'legacy_migration_run'");
    expect(secondRetryGate).toContain('migration recovery requires every target business table to remain empty');
    expect(secondRetryGate.indexOf('FOR business_relation IN')).toBeLessThan(
      secondRetryGate.indexOf('retry_evidence := NEW.retry_history'),
    );
    expect(secondRetryGate).toContain("retry_evidence - 'recoveryKind' - 'retriedAt' - 'previousFailure'");
    expect(secondRetryGate).toContain("CASE WHEN retry_kind='template-byte-size-v1' THEN OLD.updated_at ELSE OLD.failed_at END");
    const importer = await readFile(path.resolve(packageRoot, 'src/import.ts'), 'utf8');
    expect(importer.indexOf('businessTransactionStarted = true')).toBeLessThan(
      importer.indexOf('BEGIN ISOLATION LEVEL SERIALIZABLE', importer.indexOf('businessTransactionStarted = true')),
    );
    expect(importer).toContain("businessTransactionStarted ? 'transaction_started' : 'pre_transaction'");
    expect(importer).toContain('failed_at=coalesce(failed_at,now())');
    expect(importer).toContain('byteSize: sourceBytes.byteLength');
    expect(importer).toContain('byte_size: item.byteSize');
    expect(importer).not.toContain('item.bytes.byteLength');
    const verifier = await readFile(path.resolve(packageRoot, 'src/verify.ts'), 'utf8');
    expect(verifier).not.toContain("status='finalized',finalized_at=now(),updated_at=now(),error_summary=NULL");
    const runtimeGrants = await readFile(path.resolve(packageRoot, '../db/src/runtime-grants.ts'), 'utf8');
    expect(runtimeGrants).toContain('GRANT CONNECT ON DATABASE');
    expect(runtimeGrants).toContain('GRANT SELECT, INSERT, UPDATE, DELETE');
    expect(runtimeGrants).toContain('GRANT USAGE, SELECT, UPDATE');
    expect(runtimeGrants).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "campuspilot-plus-owner"');
    expect(runtimeGrants).toContain('REVOKE ALL ON TABLE public.legacy_migration_run');
    expect(runtimeGrants).toContain('runtime role must never be a member of the owner role');
    const migrateEntrypoint = await readFile(path.resolve(packageRoot, '../db/src/migrate.ts'), 'utf8');
    expect(migrateEntrypoint).toContain('await migrate(client, { migrationsFolder });');
    expect(migrateEntrypoint).toContain('await applyRuntimeDatabasePrivileges(client);');
    const releaseWorkflow = await readFile(
      path.resolve(packageRoot, '../../.github/workflows/release.yml'),
      'utf8',
    );
    expect(releaseWorkflow).toContain('postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb');
    expect(releaseWorkflow).toContain('CREATE DATABASE campuspilot_migration_fixture');
    expect(releaseWorkflow).toContain('LEGACY_MIGRATION_TEST_TARGET_POSTGRES_URL: postgresql://campuspilot-plus-migration:migration-fixture@127.0.0.1:5432/campuspilot_migration_fixture');
    expect(releaseWorkflow).toContain('integration/migration-run-postgres17.test.ts');
  });
});
