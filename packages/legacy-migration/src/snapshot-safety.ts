import type { PostgreSqlRuntimeIdentity } from './database-runtime.ts';
import { assertSnapshotAdminRuntime } from './migration-guards.ts';

/**
 * Bind the DDL-capable endpoint to the already-opened canonical restored
 * source. The callback is invoked only after both the operator authorization
 * and cluster identity equality have passed.
 */
export async function withAuthorizedSnapshotAdmin<T>(options: {
  adminConnectionString: string;
  authorization: {
    allowedDatabaseIdentities: string;
    expectedSystemIdentifier: string;
    expectedRole: string;
    requireTls: boolean;
  };
  canonicalRuntime: PostgreSqlRuntimeIdentity;
  adminRuntime: PostgreSqlRuntimeIdentity;
  action: () => Promise<T>;
}) {
  assertSnapshotAdminRuntime({
    connectionString: options.adminConnectionString,
    ...options.authorization,
    runtime: options.adminRuntime,
  });
  if (
    options.adminRuntime.systemIdentifier !==
    options.canonicalRuntime.systemIdentifier
  ) {
    throw new Error(
      'Snapshot admin cluster does not match the connected canonical restored source',
    );
  }
  return options.action();
}
