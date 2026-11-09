import type { DataMigration } from './types';

/**
 * Every data migration, in the order they were added. IDs are stable and
 * never reused. On boot the API server registers an apply run for each
 * migration that has none pending, running or completed (a failed one is
 * registered again after a deploy) and hands it to the worker; the server
 * does not wait for it (D-36), so code must tolerate unmigrated rows.
 */
export const DATA_MIGRATIONS: readonly DataMigration[] = [];

const byId = new Map(DATA_MIGRATIONS.map((migration) => [migration.id, migration]));

/** The registered migration with this ID, or undefined (e.g. removed from code). */
export function findDataMigration(id: string): DataMigration | undefined {
  return byId.get(id);
}
