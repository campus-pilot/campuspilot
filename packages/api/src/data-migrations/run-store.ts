import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { generateId } from '@campuspilot/db/id';
import {
  dataMigrationRunTable,
  dataMigrationSkippedItemTable,
} from '@campuspilot/db/schema/data-migration';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DATA_MIGRATIONS } from './registry';
import type { DataMigration, DataMigrationBatchResult } from './types';

export type DataMigrationRun = typeof dataMigrationRunTable.$inferSelect;

/** A deterministic, safe-to-show failure of a run (bad cursor, unknown migration). */
export class DataMigrationError extends Error {
  override name = 'DataMigrationError';
}

/** Thrown inside a dry run's savepoint to roll back its writes while keeping the result. */
class DryRunRollback extends Error {
  constructor(readonly result: DataMigrationBatchResult) {
    super('Dry run rollback');
  }
}

const ACTIVE_STATUSES = ['pending', 'running'] as const;

/**
 * Registers an apply run (`pending`) for every migration that has no apply
 * run pending, running or completed. Called once per API boot (D-36: boot
 * does not wait for the run). A migration whose last apply run failed is
 * registered again, so a deploy with a fix retries it. Replicas booting
 * together are safe: the partial unique index admits one active run per
 * migration and the insert ignores the conflict. Returns the new run IDs.
 */
export async function registerPendingDataMigrations(
  db: DatabaseExecutor = defaultDb,
  migrations: readonly Pick<DataMigration, 'id'>[] = DATA_MIGRATIONS,
): Promise<string[]> {
  const registered: string[] = [];
  for (const migration of migrations) {
    const result = await db.execute<{ id: string }>(sql`
      insert into ${dataMigrationRunTable} (id, migration_id, dry_run)
      select ${generateId('dataMigrationRun')}, ${migration.id}, false
      where not exists (
        select 1 from ${dataMigrationRunTable}
        where ${dataMigrationRunTable.migrationId} = ${migration.id}
          and ${dataMigrationRunTable.dryRun} = false
          and ${dataMigrationRunTable.status} in ('pending', 'running', 'completed')
      )
      on conflict do nothing
      returning id`);
    registered.push(...result.rows.map((row) => row.id));
  }
  return registered;
}

/**
 * Of these migrations, the ones that still have no apply run pending,
 * running or completed: their registration has not happened yet, typically
 * because an admin's dry run was active (one active run per migration), so
 * the insert of {@link registerPendingDataMigrations} was refused.
 */
export async function dataMigrationsAwaitingApplyRun(
  db: DatabaseExecutor,
  migrationIds: readonly string[],
): Promise<string[]> {
  if (migrationIds.length === 0) return [];
  const covered = await db
    .selectDistinct({ migrationId: dataMigrationRunTable.migrationId })
    .from(dataMigrationRunTable)
    .where(
      and(
        inArray(dataMigrationRunTable.migrationId, [...migrationIds]),
        eq(dataMigrationRunTable.dryRun, false),
        inArray(dataMigrationRunTable.status, ['pending', 'running', 'completed']),
      ),
    );
  const done = new Set(covered.map((row) => row.migrationId));
  return migrationIds.filter((id) => !done.has(id));
}

/**
 * Records a run requested by a platform admin. Returns null when the
 * migration already has a pending or running run (one at a time).
 */
export async function requestDataMigrationRun(
  db: DatabaseExecutor,
  input: { migrationId: string; dryRun: boolean; requestedBy: string },
): Promise<DataMigrationRun | null> {
  const [run] = await db
    .insert(dataMigrationRunTable)
    .values({ migrationId: input.migrationId, dryRun: input.dryRun, requestedBy: input.requestedBy })
    .onConflictDoNothing()
    .returning();
  return run ?? null;
}

export async function loadDataMigrationRun(runId: string, db: DatabaseExecutor = defaultDb): Promise<DataMigrationRun | null> {
  const [run] = await db.select().from(dataMigrationRunTable).where(eq(dataMigrationRunTable.id, runId)).limit(1);
  return run ?? null;
}

/** Moves a pending run to running (a running one stays). Null if it is no longer active. */
export async function startDataMigrationRun(runId: string, db: DatabaseExecutor = defaultDb): Promise<DataMigrationRun | null> {
  const [run] = await db
    .update(dataMigrationRunTable)
    .set({
      status: 'running',
      startedAt: sql`coalesce(${dataMigrationRunTable.startedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(dataMigrationRunTable.id, runId), inArray(dataMigrationRunTable.status, ACTIVE_STATUSES)))
    .returning();
  return run ?? null;
}

/**
 * Runs the next batch of a running run in one transaction: locks the run row,
 * reads its checkpoint, runs the batch, records skipped items and moves the
 * checkpoint and counts forward, all committed together. The checkpoint is
 * read from the row, never from the caller, so a batch whose commit was not
 * journaled is not repeated: the retry simply runs the next batch. In a dry
 * run the batch runs inside a savepoint that is rolled back, so only this
 * run's own row and report change.
 *
 * Returns `stopped` when the run is no longer running (failed or completed
 * elsewhere), otherwise whether every item has been processed.
 */
export async function runDataMigrationBatch(
  runId: string,
  migration: DataMigration,
  db: DatabaseExecutor = defaultDb,
): Promise<{ state: 'stopped' } | { state: 'continue' | 'done'; processed: number }> {
  return db.transaction(async (transaction) => {
    const [run] = await transaction
      .select()
      .from(dataMigrationRunTable)
      .where(and(eq(dataMigrationRunTable.id, runId), eq(dataMigrationRunTable.status, 'running')))
      .limit(1)
      .for('update');
    if (!run) return { state: 'stopped' as const };
    if (run.migrationId !== migration.id) throw new DataMigrationError('The run belongs to another migration.');
    const input = { cursor: run.checkpoint, limit: migration.batchSize };
    let result: DataMigrationBatchResult;
    if (run.dryRun) {
      try {
        await transaction.transaction(async (savepoint) => {
          throw new DryRunRollback(await migration.runBatch(savepoint, input));
        });
        throw new Error('unreachable');
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
        result = error.result;
      }
    } else {
      result = await migration.runBatch(transaction, input);
    }
    if (result.nextCursor !== null && result.nextCursor === run.checkpoint) {
      throw new DataMigrationError('The migration did not advance its cursor.');
    }
    if (result.nextCursor !== null && result.processed === 0) {
      throw new DataMigrationError('The migration returned a cursor without processing any item.');
    }
    const inserted = result.skipped.length > 0
      ? await transaction
        .insert(dataMigrationSkippedItemTable)
        .values(result.skipped.map((item) => ({ runId, itemKey: item.itemKey, reason: item.reason, detail: item.detail ?? null })))
        .onConflictDoNothing()
        .returning({ itemKey: dataMigrationSkippedItemTable.itemKey })
      : [];
    await transaction
      .update(dataMigrationRunTable)
      .set({
        checkpoint: result.nextCursor ?? run.checkpoint,
        batchCount: sql`${dataMigrationRunTable.batchCount} + 1`,
        processedCount: sql`${dataMigrationRunTable.processedCount} + ${result.processed}`,
        changedCount: sql`${dataMigrationRunTable.changedCount} + ${result.changed}`,
        skippedCount: sql`${dataMigrationRunTable.skippedCount} + ${inserted.length}`,
        updatedAt: new Date(),
      })
      .where(eq(dataMigrationRunTable.id, runId));
    return { state: result.nextCursor === null ? 'done' as const : 'continue' as const, processed: result.processed };
  });
}

/** Marks a running run completed; a no-op for any other status. */
export async function completeDataMigrationRun(runId: string, db: DatabaseExecutor = defaultDb) {
  const [run] = await db
    .update(dataMigrationRunTable)
    .set({ status: 'completed', finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(dataMigrationRunTable.id, runId), eq(dataMigrationRunTable.status, 'running')))
    .returning({ id: dataMigrationRunTable.id });
  return Boolean(run);
}

/** Marks an active run failed with a safe message; a no-op once it finished. */
export async function failDataMigrationRun(runId: string, message: string, db: DatabaseExecutor = defaultDb) {
  const [run] = await db
    .update(dataMigrationRunTable)
    .set({ status: 'failed', error: message, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(dataMigrationRunTable.id, runId), inArray(dataMigrationRunTable.status, ACTIVE_STATUSES)))
    .returning({ id: dataMigrationRunTable.id });
  return Boolean(run);
}
