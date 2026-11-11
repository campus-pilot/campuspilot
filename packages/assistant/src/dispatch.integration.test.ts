import { assistantApprovalTable, assistantRunTable } from '@campuspilot/db/schema/assistant';
import { eq } from 'drizzle-orm';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createLogger } from '@campuspilot/logger';

import { db } from './db';
import { generateId } from './ids';
import { createRunProcessor } from './runtime/conversation';
import { createFakeProvider, fakeProviderRegistry, fakeReply } from './runtime/providers/fake';
import { createFakeRunContext } from './testing/run-context';
import { configureDispatcher, handOverRun, RUN_HANDOVER_DEADLINE_MS, sweepAssistantOutbox } from './dispatch';
import * as store from './store';
import { seedTurn } from './testing/turn';

/**
 * The assistant's outbox against the real store: hand-over after commit,
 * the sweep's re-send, the deadline for runs, and re-sent decisions. The
 * Restate sends are replaced; other test files' rows may be swept too, so
 * every assertion names this file's rows.
 */
function fakeDispatcher(failures = 0) {
  let left = failures;
  const fail = async () => {
    if (left > 0) {
      left -= 1;
      throw new Error('Restate is unreachable');
    }
  };
  const dispatcher = { startRun: vi.fn(fail), resolveApproval: vi.fn(fail) };
  configureDispatcher(dispatcher);
  onTestFinished(() => configureDispatcher(null));
  return dispatcher;
}

const runOf = async (runId: string) => (await store.findRun(db, runId))!;

/** Moves a row's clock back, as if it had been saved earlier. */
const age = (runId: string, ms: number) =>
  db.update(assistantRunTable).set({ createdAt: new Date(Date.now() - ms) }).where(eq(assistantRunTable.id, runId));

describe('the run outbox', () => {
  it('records a failed hand-over and leaves the run to the sweep, which sends it once Restate is back', async () => {
    const dispatcher = fakeDispatcher(1);
    const turn = await seedTurn();

    await expect(handOverRun(turn.runId)).resolves.toBe(false);
    expect(await runOf(turn.runId)).toMatchObject({
      status: 'queued',
      handedOverAt: null,
      handoverAttempts: 1,
      lastHandoverError: 'Restate is unreachable.',
    });

    await age(turn.runId, 60_000);
    await sweepAssistantOutbox();
    expect(dispatcher.startRun).toHaveBeenCalledWith({ runId: turn.runId });
    const run = await runOf(turn.runId);
    expect(run).toMatchObject({ status: 'queued', handoverAttempts: 2, lastHandoverError: null });
    expect(run.handedOverAt).toBeInstanceOf(Date);

    // Handed over: nothing is sent again.
    dispatcher.startRun.mockClear();
    await sweepAssistantOutbox();
    expect(dispatcher.startRun).not.toHaveBeenCalledWith({ runId: turn.runId });
  });

  it('leaves a run that was just saved to the request that saved it', async () => {
    const dispatcher = fakeDispatcher();
    const turn = await seedTurn();
    await sweepAssistantOutbox();
    expect(dispatcher.startRun).not.toHaveBeenCalledWith({ runId: turn.runId });
  });

  it('fails a run Restate never accepted within the deadline, with the last hand-over error', async () => {
    const dispatcher = fakeDispatcher(1);
    const turn = await seedTurn();
    await handOverRun(turn.runId);
    dispatcher.startRun.mockClear();
    await age(turn.runId, RUN_HANDOVER_DEADLINE_MS + 60_000);

    await sweepAssistantOutbox();

    expect(dispatcher.startRun).not.toHaveBeenCalledWith({ runId: turn.runId });
    const run = await runOf(turn.runId);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'dispatch_failed',
      errorMessage: 'The assistant could not start. Please try again.',
      errorDetail: 'Restate is unreachable.',
      handedOverAt: null,
    });
    expect(run.completedAt).toBeInstanceOf(Date);
  });
});

describe('the decision outbox', () => {
  it('re-sends a saved decision until Restate accepts it, and never a pending approval', async () => {
    const dispatcher = fakeDispatcher(1);
    const turn = await seedTurn();
    const approval = await store.assistantTransaction(db, async (tx, emit) => {
      const item = await store.insertItem(tx, emit, {
        conversationId: turn.conversationId,
        runId: turn.runId,
        kind: 'tool_call',
        status: 'awaiting_approval',
        body: { toolUseId: 'tu', toolName: 't', title: 'T', access: 'write', destructive: false, module: 'students', input: {} },
        itemKey: 'tool:tu',
      });
      return store.insertApproval(tx, { conversationId: turn.conversationId, runId: turn.runId, itemId: item.id, schoolId: turn.schoolId, userId: turn.userId, toolName: 't', awakeableId: 'awk' });
    });
    await sweepAssistantOutbox();
    expect(dispatcher.resolveApproval).not.toHaveBeenCalledWith({ approvalId: approval.id });

    await store.decideApproval(db, approval.id, 'approved');
    await db.update(assistantApprovalTable).set({ decidedAt: new Date(Date.now() - 60_000) }).where(eq(assistantApprovalTable.id, approval.id));
    await sweepAssistantOutbox();
    expect(await store.findApproval(db, approval.id)).toMatchObject({ resolutionHandedOverAt: null, resolutionHandoverAttempts: 1 });

    await sweepAssistantOutbox();
    const handed = await store.findApproval(db, approval.id);
    expect(handed?.resolutionHandedOverAt).toBeInstanceOf(Date);
    expect(handed?.resolutionHandoverAttempts).toBe(2);
    expect(dispatcher.resolveApproval).toHaveBeenCalledTimes(2);
    expect(dispatcher.resolveApproval).toHaveBeenLastCalledWith({ approvalId: approval.id });
  });
});

describe('runs Restate accepted but never started', () => {
  const handedOver = (runId: string, ms: number) =>
    db.update(assistantRunTable).set({ handedOverAt: new Date(Date.now() - ms) }).where(eq(assistantRunTable.id, runId));

  it('are failed with not_started after the deadline, and a late start then does nothing', async () => {
    fakeDispatcher();
    const turn = await seedTurn();
    await handedOver(turn.runId, RUN_HANDOVER_DEADLINE_MS + 60_000);

    await sweepAssistantOutbox();

    const run = await runOf(turn.runId);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'not_started', startedAt: null });
    // The worker's first step sees a run that ended and leaves it alone.
    const provider = createFakeProvider({ script: [fakeReply({ text: 'never' })] });
    const processRun = createRunProcessor({ providers: fakeProviderRegistry(provider), log: createLogger({ pkg: 'test' }), checkAccess: async () => ({ allowed: true }) });
    await processRun(createFakeRunContext(), turn.input);
    expect(provider.calls).toHaveLength(0);
    expect(await runOf(turn.runId)).toMatchObject({ status: 'failed', errorCode: 'not_started' });
  });

  it('are left queued while an earlier run of the conversation is unfinished (they wait behind it)', async () => {
    fakeDispatcher();
    const first = await seedTurn();
    await store.assistantTransaction(db, (tx, emit) =>
      store.updateRun(tx, emit, { id: first.runId, conversationId: first.conversationId }, { status: 'awaiting_approval', startedAt: new Date() }),
    );
    const secondId = generateId('run');
    await store.assistantTransaction(db, (tx, emit) =>
      store.insertRun(tx, emit, { id: secondId, conversationId: first.conversationId, schoolId: first.schoolId, userId: first.userId, clientRequestId: crypto.randomUUID(), surface: 'panel' }),
    );
    await handedOver(secondId, RUN_HANDOVER_DEADLINE_MS + 60_000);

    await sweepAssistantOutbox();

    expect(await runOf(secondId)).toMatchObject({ status: 'queued' });
  });
});
