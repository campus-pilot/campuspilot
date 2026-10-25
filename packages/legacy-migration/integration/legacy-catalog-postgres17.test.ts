import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { captureLegacyCatalog } from '../src/legacy-catalog-contract.ts';

const connectionString = process.env.LEGACY_MIGRATION_TEST_POSTGRES_URL;
const describeWithPostgres = connectionString ? describe : describe.skip;

/**
 * The integration URL must point at an isolated fixture database because this
 * test creates a transaction-scoped public table to exercise the real catalog.
 */
function assertFixtureDatabase(value: string): void {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^legacy_fixture(?:_|$)/.test(database)) {
    throw new Error(
      'LEGACY_MIGRATION_TEST_POSTGRES_URL must select an isolated legacy_fixture database',
    );
  }
}

describeWithPostgres('legacy catalog query on PostgreSQL 17', () => {
  it('executes constraint and index discovery without reserved-alias syntax errors', async () => {
    assertFixtureDatabase(connectionString!);
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const version = await client.query<{ server_version_num: string }>(
        'SHOW server_version_num',
      );
      expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(170_000);
      expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(180_000);

      await client.query('BEGIN');
      await client.query(`
        CREATE TABLE public.legacy_catalog_query_regression (
          id text PRIMARY KEY,
          parent_id text REFERENCES public.legacy_catalog_query_regression(id)
        )
      `);

      const catalog = await captureLegacyCatalog(client);
      const table = catalog.tables.find(
        ({ name }) => name === 'public.legacy_catalog_query_regression',
      );
      expect(table?.constraints.map(({ kind }) => kind).toSorted()).toEqual([
        'f',
        'p',
      ]);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
