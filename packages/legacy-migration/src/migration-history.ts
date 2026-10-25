import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MigrationRecord } from './migration-guards.ts';

/** Read the exact ordered Drizzle history represented by a migration directory. */
export async function migrationHistory(
  migrationDirectory: string,
): Promise<MigrationRecord[]> {
  const journal = JSON.parse(
    await readFile(path.join(migrationDirectory, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string; when: number }> };
  const history: MigrationRecord[] = [];
  for (const entry of journal.entries) {
    const sql = await readFile(
      path.join(migrationDirectory, `${entry.tag}.sql`),
    );
    history.push({
      hash: createHash('sha256').update(sql).digest('hex'),
      created_at: entry.when,
    });
  }
  return history;
}

/** Match PostgreSQL COPY output used by the Kubernetes COMPLETE gate. */
export function migrationHistoryCopyBytes(history: MigrationRecord[]): Buffer {
  return Buffer.from(
    history.map((entry) => `${entry.hash}|${entry.created_at}\n`).join(''),
  );
}

export const targetMigrationDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../db/src/migrations',
);
