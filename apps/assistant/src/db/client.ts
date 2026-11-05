import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '@campuspilot/env/assistant';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

import { log } from '../log';
import * as schema from './schema';

export type AssistantDatabase = NodePgDatabase<typeof schema> & { $client: Pool };
export type AssistantTransaction = Parameters<
  Parameters<AssistantDatabase['transaction']>[0]
>[0];
export type AssistantExecutor = AssistantDatabase | AssistantTransaction;

export const db: AssistantDatabase = drizzle(env.ASSISTANT_DATABASE_URL, { schema });

const DEFAULT_MIGRATIONS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Session advisory lock so replicas starting together migrate one at a time. */
const MIGRATION_LOCK_SQL = "SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended('campuspilot.assistant.migrate', 0))";

/**
 * Applies the assistant's own migrations, inside its own `assistant` schema
 * and journal table, before the service serves traffic.
 */
export async function migrateAssistantDatabase(): Promise<void> {
  const start = performance.now();
  const client = await db.$client.connect();
  try {
    await client.query(MIGRATION_LOCK_SQL);
    await migrate(drizzle(client), {
      migrationsFolder: env.ASSISTANT_DB_MIGRATIONS_PATH ?? DEFAULT_MIGRATIONS_PATH,
      migrationsSchema: 'assistant',
      migrationsTable: '__assistant_migrations',
    });
    log.info({ durationMs: Math.round(performance.now() - start) }, 'assistant.db.migrated');
  } finally {
    client.release(true);
  }
}
