import { readFileSync } from 'node:fs';

import { runMigrations } from '@campuspilot/db/migrate';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Mirrors the deployed roles: a login that inherits a non-login owner role,
// which owns the database. The container's own user is a superuser.
const suffix = crypto.randomUUID().slice(0, 8);
const OWNER = `migrate-owner-${suffix}`;
const LOGIN = `migrate-login-${suffix}`;
const PASSWORD = 'migrate-password';
const DATABASE = `migrate-${suffix}`;

const journal = JSON.parse(
  readFileSync(
    new URL(
      '../../../packages/db/src/migrations/meta/_journal.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { entries: unknown[] };

function databaseUrl(credentials?: { user: string; password: string }) {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${DATABASE}`;
  if (credentials) {
    url.username = credentials.user;
    url.password = credentials.password;
  }
  return url.toString();
}

/** Objects in the migrated schemas not owned by the owner role; extension members excluded. */
const FOREIGN_OWNED_SQL = `
SELECT 'relation' AS kind, c.relname AS name, pg_catalog.pg_get_userbyid(c.relowner) AS owner
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'drizzle')
  AND c.relowner <> '"${OWNER}"'::regrole
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS d
    WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
  )
UNION ALL
SELECT 'type', t.typname, pg_catalog.pg_get_userbyid(t.typowner)
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typtype IN ('e', 'd')
  AND t.typowner <> '"${OWNER}"'::regrole
UNION ALL
SELECT 'function', p.proname, pg_catalog.pg_get_userbyid(p.proowner)
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proowner <> '"${OWNER}"'::regrole
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend AS d
    WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
  )
UNION ALL
SELECT 'schema', n.nspname, pg_catalog.pg_get_userbyid(n.nspowner)
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname = 'drizzle' AND n.nspowner <> '"${OWNER}"'::regrole
`;

const admin = drizzle(process.env.DATABASE_URL ?? '');

beforeAll(async () => {
  await admin.execute(sql.raw(`CREATE ROLE "${OWNER}" NOLOGIN`));
  await admin.execute(
    sql.raw(
      `CREATE ROLE "${LOGIN}" LOGIN PASSWORD '${PASSWORD}' IN ROLE "${OWNER}"`,
    ),
  );
  await admin.execute(sql.raw(`CREATE DATABASE "${DATABASE}" OWNER "${OWNER}"`));
});

afterAll(async () => {
  await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`));
  await admin.execute(sql.raw(`DROP ROLE IF EXISTS "${LOGIN}"`));
  await admin.execute(sql.raw(`DROP ROLE IF EXISTS "${OWNER}"`));
  await admin.$client.end();
});

describe('runMigrations', () => {
  it('applies every migration once across concurrent runners, owned by the database owner', async () => {
    const loginUrl = databaseUrl({ user: LOGIN, password: PASSWORD });
    await Promise.all([
      runMigrations({ databaseUrl: loginUrl }),
      runMigrations({ databaseUrl: loginUrl }),
      runMigrations({ databaseUrl: loginUrl }),
    ]);

    const target = drizzle(databaseUrl());
    try {
      const applied = await target.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
      );
      expect(applied.rows[0]?.count).toBe(journal.entries.length);

      const foreignOwned = await target.execute(sql.raw(FOREIGN_OWNED_SQL));
      expect(foreignOwned.rows).toEqual([]);
    } finally {
      await target.$client.end();
    }
  });

  it('is a no-op when nothing is pending', async () => {
    await expect(
      runMigrations({
        databaseUrl: databaseUrl({ user: LOGIN, password: PASSWORD }),
      }),
    ).resolves.toBeUndefined();
  });
});
