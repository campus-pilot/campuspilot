import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from '@campuspilot/env/server';

import { log } from './log';
import * as schema from './schema';

const DEFAULT_MIGRATIONS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export async function runMigrations(): Promise<void> {
  const migrationsFolder = env.DB_MIGRATIONS_PATH ?? DEFAULT_MIGRATIONS_PATH;
  log.info({ migrationsFolder }, 'db.migrate.start');
  const start = performance.now();
  const client = drizzle<typeof schema>(env.DATABASE_URL, { schema });
  try {
    await migrate(client, { migrationsFolder });
    const durationMs = Math.round(performance.now() - start);
    log.info({ durationMs }, 'db.migrate.ok');
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    log.error({ err, durationMs }, 'db.migrate.fail');
    throw err;
  }
}
