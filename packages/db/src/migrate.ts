import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { env } from '@campuspilot/env/migration';

import { log } from './log';
import * as schema from './schema';

const DEFAULT_MIGRATIONS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

/** Session-level advisory lock key shared by every migration runner. */
const MIGRATION_LOCK_KEY_SQL =
  "pg_catalog.hashtextextended('campuspilot.db.migrate', 0)";

/**
 * The database owner to act as, when the login is a non-superuser member of
 * it. Superusers (local development, Testcontainers) and the owner itself
 * migrate as themselves.
 */
const OWNER_ROLE_SQL = `
SELECT pg_catalog.pg_get_userbyid(d.datdba) AS owner
FROM pg_catalog.pg_database AS d
CROSS JOIN pg_catalog.pg_roles AS login
WHERE d.datname = pg_catalog.current_database()
  AND login.rolname = session_user
  AND NOT login.rolsuper
  AND d.datdba <> login.oid
  AND pg_catalog.pg_has_role(login.oid, d.datdba, 'SET')
`;

export interface RunMigrationsOptions {
  /** Defaults to `DATABASE_URL`. */
  databaseUrl?: string;
  /** Defaults to `DB_MIGRATIONS_PATH`, then the package's migrations folder. */
  migrationsFolder?: string;
}

/**
 * Applies pending Drizzle migrations. The API calls this at startup, before it
 * serves traffic; `apps/server/src/migrate.ts` runs it on its own.
 *
 * Deployed databases use one login (the API's `DATABASE_URL`) that is a member
 * of a non-login `<database>-owner` role owning the database and every object
 * in it. The run uses a single connection that:
 * - holds a session advisory lock, so replicas starting together migrate one
 *   at a time and the later ones find nothing pending;
 * - switches to the database owner role when the login is a member of it, so
 *   new tables, types and functions get the same owner as existing ones.
 */
export async function runMigrations(
  options: RunMigrationsOptions = {},
): Promise<void> {
  const migrationsFolder =
    options.migrationsFolder ?? env.DB_MIGRATIONS_PATH ?? DEFAULT_MIGRATIONS_PATH;
  const start = performance.now();
  const client = new pg.Client({
    connectionString: options.databaseUrl ?? env.DATABASE_URL,
    application_name: 'campuspilot-migrate',
  });
  try {
    await client.connect();
    await client.query(`SELECT pg_catalog.pg_advisory_lock(${MIGRATION_LOCK_KEY_SQL})`);
    const { rows } = await client.query<{ owner: string }>(OWNER_ROLE_SQL);
    const role = rows[0]?.owner ?? null;
    if (role) await client.query(`SET ROLE ${client.escapeIdentifier(role)}`);
    log.info({ migrationsFolder, role }, 'db.migrate.start');
    await migrate(drizzle(client, { schema }), { migrationsFolder });
    await client.query(`SELECT pg_catalog.pg_advisory_unlock(${MIGRATION_LOCK_KEY_SQL})`);
    const durationMs = Math.round(performance.now() - start);
    log.info({ durationMs }, 'db.migrate.ok');
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    log.error({ err, durationMs }, 'db.migrate.fail');
    throw err;
  } finally {
    // Ending the session also releases the lock when the run failed. A failed
    // end must not hide the migration error.
    await client.end().catch(() => undefined);
  }
}
