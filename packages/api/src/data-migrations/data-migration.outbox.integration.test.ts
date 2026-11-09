import { db } from '@campuspilot/db';
import { dataMigrationRunTable } from '@campuspilot/db/schema/data-migration';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestUser } from '../../test/fixtures';
import { requestDataMigrationRun } from './run-store';

vi.mock('./data-migration.restate', () => ({ sendDataMigrationStart: vi.fn() }));
vi.mock('../workflows/restate-admin', () => ({ getRestateInvocation: vi.fn(), cancelRestateInvocation: vi.fn() }));

const { sendDataMigrationStart } = await import('./data-migration.restate');
const { getRestateInvocation, cancelRestateInvocation } = await import('../workflows/restate-admin');
const { dispatchDataMigrationRun } = await import('./data-migration.outbox');

async function requested() {
  const run = await requestDataMigrationRun(db, { migrationId: `outbox-${randomUUID()}`, dryRun: true, requestedBy: (await createTestUser()).id });
  return run!.id;
}

describe('data migration outbox', () => {
  beforeEach(() => vi.mocked(sendDataMigrationStart).mockReset());

  it('records an accepted hand-over once', async () => {
    const runId = await requested();
    vi.mocked(sendDataMigrationStart).mockResolvedValue({ invocationId: 'inv_control1' });
    expect(await dispatchDataMigrationRun(db, runId)).toBe(true);
    // Already accepted: not sent again.
    expect(await dispatchDataMigrationRun(db, runId)).toBe(false);
    expect(sendDataMigrationStart).toHaveBeenCalledTimes(1);
    const [run] = await db.select().from(dataMigrationRunTable).where(eq(dataMigrationRunTable.id, runId));
    expect(run).toMatchObject({ submitInvocationId: 'inv_control1', submitAttempts: 1, lastSubmitError: null, status: 'pending' });
    expect(run!.submittedAt).toBeInstanceOf(Date);
  });

  it('keeps a run pending with a safe error while Restate is unreachable', async () => {
    const runId = await requested();
    vi.mocked(sendDataMigrationStart).mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:8080'));
    expect(await dispatchDataMigrationRun(db, runId)).toBe(false);
    const [run] = await db.select().from(dataMigrationRunTable).where(eq(dataMigrationRunTable.id, runId));
    expect(run).toMatchObject({ status: 'pending', submittedAt: null, submitAttempts: 1, lastSubmitError: 'Restate is unreachable.' });
  });

  it('fails an accepted run whose invocation Restate paused', async () => {
    const { sweepDataMigrationOutbox } = await import('./data-migration.outbox');
    const runId = await requested();
    await db
      .update(dataMigrationRunTable)
      .set({ submittedAt: new Date(Date.now() - 5 * 60_000), submitInvocationId: 'inv_control2', invocationId: 'inv_workflow2', status: 'running' })
      .where(eq(dataMigrationRunTable.id, runId));
    vi.mocked(getRestateInvocation).mockImplementation(async (id) => ({ status: id === 'inv_workflow2' ? 'paused' : 'running', createdAt: Date.now() }));
    await sweepDataMigrationOutbox({ register: false });
    expect(cancelRestateInvocation).toHaveBeenCalledWith('inv_workflow2');
    const [run] = await db.select().from(dataMigrationRunTable).where(eq(dataMigrationRunTable.id, runId));
    expect(run).toMatchObject({ status: 'failed' });
    expect(run!.error).toMatch(/paused/);
  });
});
