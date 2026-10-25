import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

import { migrationSourceVersion, runDirectory, snapshotAdminAuthorization, snapshotAdminDatabaseUrl, sourceAuthorization, sourceDatabaseUrl } from './config.ts';
import { assertAllowedSourceSnapshot, databaseIdentity, type MigrationRecord } from './migration-guards.ts';
import { captureSourceEvidence, assertSourceEvidence, sha256, stableJson } from './source-evidence.ts';
import { postgresRuntimeIdentity } from './database-runtime.ts';
import { withAuthorizedSnapshotAdmin } from './snapshot-safety.ts';

const execFile = promisify(execFileCallback);
const { Client, types } = pg;
types.setTypeParser(1114, (value: string) => value);
const dumpFile = process.env.MIGRATION_SOURCE_DUMP_FILE;
if (!dumpFile) throw new Error('MIGRATION_SOURCE_DUMP_FILE is required');
const databaseName = `legacy_validation_${randomUUID().replaceAll('-', '')}`;
if (!/^legacy_validation_[0-9a-f]{32}$/.test(databaseName)) throw new Error('Unsafe validation database name');
const adminUrl = snapshotAdminDatabaseUrl();
const canonicalUrl = sourceDatabaseUrl();
const sourceAccess = sourceAuthorization();
const adminAuthorization = snapshotAdminAuthorization();
const validationUrl = new URL(adminUrl);
validationUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl });
const canonical = new Client({ connectionString: canonicalUrl });
let created = false;
let boundAdminRuntime: Awaited<ReturnType<typeof postgresRuntimeIdentity>> | undefined;
let boundCanonicalRuntime: Awaited<ReturnType<typeof postgresRuntimeIdentity>> | undefined;

async function history(client: InstanceType<typeof Client>) {
  return (await client.query<MigrationRecord>('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id')).rows;
}

await canonical.connect();
try {
  assertAllowedSourceSnapshot({
    connectionString: canonicalUrl,
    environment: sourceAccess.environment,
    allowedDatabaseIdentities: sourceAccess.allowedDatabaseIdentities,
  });
  await canonical.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const canonicalReadOnly = await canonical.query<{ transaction_read_only: string }>('SHOW transaction_read_only');
  if (canonicalReadOnly.rows[0]?.transaction_read_only !== 'on')
    throw new Error('Canonical restored source transaction is not read-only');
  const canonicalRuntime = await postgresRuntimeIdentity(canonical, canonicalUrl);
  boundCanonicalRuntime = canonicalRuntime;
  await admin.connect();
  const adminRuntime = await postgresRuntimeIdentity(admin, adminUrl);
  boundAdminRuntime = adminRuntime;
  await withAuthorizedSnapshotAdmin({
    adminConnectionString: adminUrl,
    authorization: adminAuthorization,
    canonicalRuntime,
    adminRuntime,
    action: () => admin.query(`CREATE DATABASE "${databaseName}"`),
  });
  created = true;
  const emptyValidation = new Client({ connectionString: validationUrl.toString() });
  await emptyValidation.connect();
  try {
    const preRestoreRuntime = await postgresRuntimeIdentity(emptyValidation, validationUrl.toString());
    if (preRestoreRuntime.systemIdentifier !== adminRuntime.systemIdentifier ||
      preRestoreRuntime.currentUser !== adminAuthorization.expectedRole ||
      (adminAuthorization.requireTls && !preRestoreRuntime.tls.active))
      throw new Error('Temporary validation database is not on the approved isolated snapshot cluster');
  } finally {
    await emptyValidation.end();
  }
  const pgpassDirectory = await mkdtemp(path.join(os.tmpdir(), 'legacy-pgpass-'));
  const pgpassFile = path.join(pgpassDirectory, 'pgpass');
  const escapePgpass = (value: string) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  await writeFile(pgpassFile, [
    escapePgpass(validationUrl.hostname),
    escapePgpass(validationUrl.port || '5432'),
    escapePgpass(databaseName),
    escapePgpass(decodeURIComponent(validationUrl.username)),
    escapePgpass(decodeURIComponent(validationUrl.password)),
  ].join(':') + '\n', { mode: 0o600 });
  await chmod(pgpassDirectory, 0o700);
  await chmod(pgpassFile, 0o600);
  const restoreEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: validationUrl.hostname,
    PGPORT: validationUrl.port || '5432',
    PGDATABASE: databaseName,
    PGUSER: decodeURIComponent(validationUrl.username),
    PGPASSFILE: pgpassFile,
    PGSSLMODE: validationUrl.searchParams.get('sslmode') ?? (adminAuthorization.requireTls ? 'require' : 'prefer'),
  };
  delete restoreEnvironment.PGPASSWORD;
  try {
    await execFile('pg_restore', [
      '--exit-on-error', '--no-owner', '--no-privileges', path.resolve(dumpFile),
    ], { env: restoreEnvironment });
  } catch {
    throw new Error('pg_restore failed for the approved temporary validation database');
  } finally {
    await rm(pgpassDirectory, { recursive: true, force: true });
  }
  const validation = new Client({ connectionString: validationUrl.toString() });
  await validation.connect();
  try {
    await validation.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const canonicalEvidence = await captureSourceEvidence({ client: canonical, sourceVersion: migrationSourceVersion(), sourceDatabaseIdentity: databaseIdentity(canonicalUrl), migrationHistory: await history(canonical) });
    const validationEvidence = await captureSourceEvidence({ client: validation, sourceVersion: migrationSourceVersion(), sourceDatabaseIdentity: databaseIdentity(canonicalUrl), migrationHistory: await history(validation) });
    assertSourceEvidence(canonicalEvidence, validationEvidence);
    const [validationRuntime, cutoff] = await Promise.all([
      postgresRuntimeIdentity(validation, validationUrl.toString()),
      canonical.query(`SELECT pg_is_in_recovery() AS in_recovery,pg_last_wal_replay_lsn()::text AS replay_lsn,txid_current_snapshot()::text AS transaction_snapshot`),
    ]);
    if (validationRuntime.systemIdentifier !== adminRuntime.systemIdentifier ||
      validationRuntime.currentUser !== adminAuthorization.expectedRole ||
      (adminAuthorization.requireTls && !validationRuntime.tls.active))
      throw new Error('Temporary restored database runtime is not on the approved isolated snapshot cluster');
    const evidence = {
      schemaVersion: 1, dumpSha256: sha256(await readFile(path.resolve(dumpFile))),
      canonicalDatabaseIdentity: databaseIdentity(canonicalUrl),
      adminRuntime,
      canonicalRuntime, validationRuntime: { ...validationRuntime, database: '<temporary-validation-database>' },
      recoveryCutoff: cutoff.rows[0], sourceEvidenceSha256: sha256(stableJson(canonicalEvidence)),
      catalogAndDrizzleFingerprint: sha256(stableJson({
        tables: canonicalEvidence.tables,
        migrationHistory: canonicalEvidence.migrationHistory,
        dispositionCounts: canonicalEvidence.dispositionCounts,
        catalogSha256: canonicalEvidence.catalogSha256,
        legacyStateSha256: canonicalEvidence.legacyStateSha256,
      })),
    };
    const output = path.join(runDirectory(), 'snapshot-evidence.json');
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    await chmod(output, 0o600);
    console.log(JSON.stringify({ output, dumpSha256: evidence.dumpSha256, sourceEvidenceSha256: evidence.sourceEvidenceSha256 }));
  } finally {
    await validation.query('ROLLBACK').catch(() => undefined);
    await validation.end();
  }
} finally {
  if (created) {
    if (!/^legacy_validation_[0-9a-f]{32}$/.test(databaseName)) throw new Error('Refusing unsafe validation database cleanup');
    const cleanupRuntime = await postgresRuntimeIdentity(admin, adminUrl);
    if (!boundAdminRuntime || stableJson(cleanupRuntime) !== stableJson(boundAdminRuntime))
      throw new Error('Snapshot admin runtime changed before validation database cleanup');
    if (!boundCanonicalRuntime)
      throw new Error('Canonical restored source runtime was not bound before cleanup');
    await withAuthorizedSnapshotAdmin({
      adminConnectionString: adminUrl,
      authorization: adminAuthorization,
      canonicalRuntime: boundCanonicalRuntime,
      adminRuntime: cleanupRuntime,
      action: async () => {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
        await admin.query(`DROP DATABASE "${databaseName}"`);
      },
    });
  }
  await admin.end().catch(() => undefined);
  await canonical.query('ROLLBACK').catch(() => undefined);
  await canonical.end();
}
