import { db, type DatabaseExecutor } from '@campuspilot/db';
import {
  dataMigrationRunTable,
  dataMigrationSkippedItemTable,
} from '@campuspilot/db/schema/data-migration';
import { asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { createAdminSession, createRegularUserSession, createTestClient, createTestUser } from '../../test/fixtures';
import { runDataMigrationBatches } from '../workflows/data-migration/workflow';
import {
  failDataMigrationRun,
  loadDataMigrationRun,
  dataMigrationsAwaitingApplyRun,
  registerPendingDataMigrations,
  requestDataMigrationRun,
  runDataMigrationBatch,
  startDataMigrationRun,
} from './run-store';
import type { DataMigration } from './types';

/** A scratch table only this file uses: rows with a value the test migration doubles. */
const TABLE = `dm_test_item_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const ITEMS = 7;

/** Doubles `value` once (marks `migrated`); items with a negative value are reported. */
function doublingMigration(id: string, options: { failOnce?: { afterBatch: number } } = {}): DataMigration {
  let batches = 0;
  let failed = false;
  return {
    id,
    description: 'Test migration',
    batchSize: 3,
    runBatch: async (executor: DatabaseExecutor, { cursor, limit }) => {
      batches += 1;
      const result = await executor.execute<{ id: string; value: number; migrated: boolean }>(
        sql`select id, value, migrated from ${sql.identifier(TABLE)} where ${cursor === null ? sql`true` : sql`id > ${cursor}`} order by id limit ${limit}`,
      );
      const rows = result.rows;
      let changed = 0;
      const skipped = [];
      for (const row of rows) {
        if (row.value < 0) {
          skipped.push({ itemKey: row.id, reason: 'negative_value', detail: { id: row.id } });
          continue;
        }
        if (row.migrated) continue;
        await executor.execute(sql`update ${sql.identifier(TABLE)} set value = value * 2, migrated = true where id = ${row.id}`);
        changed += 1;
      }
      // A crash after this batch's writes, before its commit.
      if (options.failOnce && !failed && batches === options.failOnce.afterBatch) {
        failed = true;
        throw new Error('simulated crash');
      }
      return { processed: rows.length, changed, skipped, nextCursor: rows.length < limit ? null : rows.at(-1)!.id };
    },
  };
}

const directStep = <T,>(_name: string, action: () => Promise<T>) => action();

async function resetItems() {
  await db.execute(sql`delete from ${sql.identifier(TABLE)}`);
  for (let index = 1; index <= ITEMS; index += 1) {
    // Item 4 is reported instead of migrated.
    await db.execute(sql`insert into ${sql.identifier(TABLE)} (id, value) values (${`item-${index}`}, ${index === 4 ? -1 : index})`);
  }
}

async function readItems() {
  const result = await db.execute<{ id: string; value: number; migrated: boolean }>(
    sql`select id, value, migrated from ${sql.identifier(TABLE)} order by id`,
  );
  return result.rows;
}

/** Creates and starts a run of a fresh migration ID. */
async function startedRun(migrationId: string, dryRun = false) {
  const run = await requestDataMigrationRun(db, { migrationId, dryRun, requestedBy: (await createTestUser()).id });
  expect(run).not.toBeNull();
  expect(await startDataMigrationRun(run!.id)).not.toBeNull();
  return run!.id;
}

describe('data migration framework', () => {
  beforeAll(async () => {
    await db.execute(sql`create table ${sql.identifier(TABLE)} (id text primary key, value integer not null, migrated boolean not null default false)`);
  });

  it('migrates every item in checkpointed batches and reports skipped items', async () => {
    await resetItems();
    const migration = doublingMigration(`test-apply-${randomUUID()}`);
    const runId = await startedRun(migration.id);

    expect(await runDataMigrationBatches({ runId, migration, step: directStep })).toBe('completed');

    const items = await readItems();
    expect(items.filter((item) => item.migrated)).toHaveLength(ITEMS - 1);
    expect(items.find((item) => item.id === 'item-5')!.value).toBe(10);
    const run = await loadDataMigrationRun(runId);
    expect(run).toMatchObject({ status: 'completed', processedCount: ITEMS, changedCount: ITEMS - 1, skippedCount: 1, batchCount: 3, checkpoint: 'item-6' });
    const skipped = await db.select().from(dataMigrationSkippedItemTable).where(eq(dataMigrationSkippedItemTable.runId, runId));
    expect(skipped).toEqual([expect.objectContaining({ itemKey: 'item-4', reason: 'negative_value' })]);
  });

  it('resumes after a crash mid-batch without applying any item twice', async () => {
    await resetItems();
    const migration = doublingMigration(`test-crash-${randomUUID()}`, { failOnce: { afterBatch: 2 } });
    const runId = await startedRun(migration.id);

    // The first batch commits; the second crashes after writing, so its
    // transaction (writes and checkpoint) rolls back.
    await expect(runDataMigrationBatches({ runId, migration, step: directStep })).rejects.toThrow('simulated crash');
    expect(await loadDataMigrationRun(runId)).toMatchObject({ status: 'running', checkpoint: 'item-3', processedCount: 3, batchCount: 1 });

    // Restate replays the workflow: the loop starts again at "batch 1" but
    // the checkpoint on the row decides what runs next.
    expect(await runDataMigrationBatches({ runId, migration, step: directStep })).toBe('completed');
    const items = await readItems();
    expect(items.map((item) => item.value)).toEqual([2, 4, 6, -1, 10, 12, 14]);
    expect(await loadDataMigrationRun(runId)).toMatchObject({ processedCount: ITEMS, changedCount: ITEMS - 1, skippedCount: 1 });
  });

  it('is idempotent: a second apply run changes nothing', async () => {
    await resetItems();
    const migration = doublingMigration(`test-rerun-${randomUUID()}`);
    const first = await startedRun(migration.id);
    await runDataMigrationBatches({ runId: first, migration, step: directStep });
    const second = await startedRun(migration.id);
    await runDataMigrationBatches({ runId: second, migration, step: directStep });

    expect((await readItems()).map((item) => item.value)).toEqual([2, 4, 6, -1, 10, 12, 14]);
    expect(await loadDataMigrationRun(second)).toMatchObject({ status: 'completed', processedCount: ITEMS, changedCount: 0, skippedCount: 1 });
  });

  it('dry run reports counts and skipped items but writes nothing', async () => {
    await resetItems();
    const before = await readItems();
    const migration = doublingMigration(`test-dry-${randomUUID()}`);
    const runId = await startedRun(migration.id, true);

    expect(await runDataMigrationBatches({ runId, migration, step: directStep })).toBe('completed');

    expect(await readItems()).toEqual(before);
    expect(await loadDataMigrationRun(runId)).toMatchObject({ status: 'completed', dryRun: true, processedCount: ITEMS, changedCount: ITEMS - 1, skippedCount: 1 });
  });

  it('stops batches of a run that is no longer running', async () => {
    await resetItems();
    const migration = doublingMigration(`test-stop-${randomUUID()}`);
    const runId = await startedRun(migration.id);
    await failDataMigrationRun(runId, 'stopped by test');
    expect(await runDataMigrationBatch(runId, migration)).toEqual({ state: 'stopped' });
    expect((await readItems()).every((item) => !item.migrated)).toBe(true);
  });

  it('reports a registration a dry run blocked until an apply run exists', async () => {
    const migration = { id: `test-blocked-${randomUUID()}` };
    const admin = (await createTestUser()).id;
    const dryRun = await requestDataMigrationRun(db, { migrationId: migration.id, dryRun: true, requestedBy: admin });
    expect(await registerPendingDataMigrations(db, [migration])).toEqual([]);
    expect(await dataMigrationsAwaitingApplyRun(db, [migration.id])).toEqual([migration.id]);
    await db.update(dataMigrationRunTable).set({ status: 'completed' }).where(eq(dataMigrationRunTable.id, dryRun!.id));
    const [applied] = await registerPendingDataMigrations(db, [migration]);
    expect(applied).toMatch(/^dmr_/);
    expect(await dataMigrationsAwaitingApplyRun(db, [migration.id])).toEqual([]);
  });

  it('registers one boot run per migration until it completes, and again after a failure', async () => {
    const migration = { id: `test-register-${randomUUID()}` };
    const [first] = await registerPendingDataMigrations(db, [migration]);
    expect(first).toMatch(/^dmr_/);
    expect(await registerPendingDataMigrations(db, [migration])).toEqual([]);
    // One active run at a time: an admin request is refused meanwhile.
    expect(await requestDataMigrationRun(db, { migrationId: migration.id, dryRun: true, requestedBy: (await createTestUser()).id })).toBeNull();

    await failDataMigrationRun(first!, 'failed by test');
    const [second] = await registerPendingDataMigrations(db, [migration]);
    expect(second).toMatch(/^dmr_/);
    await db.update(dataMigrationRunTable).set({ status: 'completed' }).where(eq(dataMigrationRunTable.id, second!));
    expect(await registerPendingDataMigrations(db, [migration])).toEqual([]);

    const runs = await db
      .select({ requestedBy: dataMigrationRunTable.requestedBy, dryRun: dataMigrationRunTable.dryRun })
      .from(dataMigrationRunTable)
      .where(eq(dataMigrationRunTable.migrationId, migration.id))
      .orderBy(asc(dataMigrationRunTable.requestedAt));
    expect(runs).toEqual([{ requestedBy: null, dryRun: false }, { requestedBy: null, dryRun: false }]);
  });

  it('lets only platform admins read and request runs', async () => {
    const admin = await createAdminSession();
    const listed = await createTestClient(admin).systemAdmin.listDataMigrations();
    expect(Array.isArray(listed.items)).toBe(true);
    await expect(createTestClient(admin).systemAdmin.requestDataMigrationRun({ migrationId: 'does-not-exist', dryRun: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(createTestClient(await createRegularUserSession()).systemAdmin.listDataMigrations()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
