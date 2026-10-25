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
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_type AS type
            JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=type.typnamespace
            WHERE namespace.nspname='public' AND type.typname='exam_plan_status'
          ) THEN
            CREATE TYPE public.exam_plan_status AS ENUM ('draft', 'ready');
          END IF;
        END
        $$;
        CREATE TABLE public.legacy_catalog_query_regression (
          z_first text PRIMARY KEY DEFAULT 'default'::text,
          a_second character varying NOT NULL DEFAULT 'current'::character varying,
          numeric_value numeric NOT NULL DEFAULT '0'::numeric,
          status public.exam_plan_status NOT NULL DEFAULT 'draft'::public.exam_plan_status,
          parent_id text REFERENCES public.legacy_catalog_query_regression(z_first)
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
      expect(table?.columns.map(({ name }) => name)).toEqual([
        'z_first',
        'a_second',
        'numeric_value',
        'status',
        'parent_id',
      ]);
      expect(table?.columns.map(({ default: value }) => value)).toEqual([
        "'default'",
        "'current'",
        '0',
        "'draft'",
        null,
      ]);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
