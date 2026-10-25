import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { postgresRuntimeIdentity } from '../src/database-runtime.ts';

const connectionString = process.env.LEGACY_MIGRATION_TEST_TLS_POSTGRES_URL;
const describeWithTlsPostgres = connectionString ? describe : describe.skip;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function assertFixtureDatabase(value: string): void {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^legacy_fixture(?:_|$)/.test(database)) {
    throw new Error(
      'LEGACY_MIGRATION_TEST_TLS_POSTGRES_URL must select an isolated legacy_fixture database',
    );
  }
}

describeWithTlsPostgres('runtime TLS attestation on PostgreSQL 17', () => {
  it('observes the session TLS row and restores the active owner role', async () => {
    assertFixtureDatabase(connectionString!);
    const admin = new pg.Client({ connectionString });
    await admin.connect();
    const owner = `legacy_tls_owner_${randomUUID().replaceAll('-', '')}`;
    let client: pg.Client | undefined;
    try {
      const version = await admin.query<{ server_version_num: string }>(
        'SHOW server_version_num',
      );
      expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(
        170_000,
      );
      expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(180_000);

      const initial = await admin.query<{ session_user_name: string }>(
        'SELECT session_user AS session_user_name',
      );
      const sessionUser = initial.rows[0]!.session_user_name;
      await admin.query(`CREATE ROLE ${quoteIdentifier(owner)} NOLOGIN`);
      await admin.query(
        `GRANT ${quoteIdentifier(owner)} TO ${quoteIdentifier(sessionUser)}`,
      );

      const startupRoleUrl = new URL(connectionString!);
      startupRoleUrl.searchParams.set('options', `-c role=${owner}`);
      client = new pg.Client({ connectionString: startupRoleUrl.toString() });
      await client.connect();

      await client.query('RESET ROLE');
      const resetRoles = await client.query<{
        current_user_name: string;
        session_user_name: string;
      }>(
        'SELECT current_user AS current_user_name,session_user AS session_user_name',
      );
      expect(resetRoles.rows[0]).toEqual({
        current_user_name: owner,
        session_user_name: sessionUser,
      });

      const identity = await postgresRuntimeIdentity(
        client,
        startupRoleUrl.toString(),
        {
          expectedCurrentUser: owner,
          expectedSessionUser: sessionUser,
        },
      );
      expect(identity.currentUser).toBe(owner);
      expect(identity.sessionUser).toBe(sessionUser);
      expect(identity.tls.active).toBe(true);
      expect(identity.tls.version).toMatch(/^TLS/);

      const restored = await client.query<{
        current_user_name: string;
        session_user_name: string;
      }>(
        'SELECT current_user AS current_user_name,session_user AS session_user_name',
      );
      expect(restored.rows[0]).toEqual({
        current_user_name: owner,
        session_user_name: sessionUser,
      });
    } finally {
      await client?.end().catch(() => undefined);
      await admin
        .query(`DROP ROLE IF EXISTS ${quoteIdentifier(owner)}`)
        .catch(() => undefined);
      await admin.end();
    }
  });
});
