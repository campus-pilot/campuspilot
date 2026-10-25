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
  });
});
