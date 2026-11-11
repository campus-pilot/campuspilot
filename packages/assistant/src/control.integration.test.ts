import { signWorkerControlCall } from '@campuspilot/api/workflows/control-auth';
import { env } from '@campuspilot/env/server';
import * as restate from '@restatedev/restate-sdk';
import { describe, expect, it, vi } from 'vitest';

import { assistantControlService } from './control';
import { ASSISTANT_CONTROL_SERVICE_NAME, type AssistantControlHandler } from './control-constants';
import { db } from './db';
import * as store from './store';
import { seedTurn } from './testing/turn';

/**
 * `AssistantControl`, the only assistant service on Restate ingress, against
 * the real store. Restate itself is replaced by a context that records what
 * the handler asks of it; the admin API answers when the call was accepted.
 */
vi.mock('@campuspilot/api/workflows/restate-admin', () => ({
  getRestateInvocation: vi.fn(async () => ({ status: 'running', createdAt: Date.now() })),
}));

function contextWith(headers: Record<string, string>) {
  const send = { processRun: vi.fn() };
  const ctx = {
    request: () => ({ id: 'inv_test', headers: new Map(Object.entries(headers)) }),
    run: vi.fn(async (_name: string, action: () => Promise<unknown>) => action()),
    objectSendClient: vi.fn(() => send),
    resolveAwakeable: vi.fn(),
  };
  return { ctx, send };
}

const signed = (handler: AssistantControlHandler, input: unknown, secret = env.WORKER_CONTROL_SECRET!) =>
  signWorkerControlCall(secret, { service: ASSISTANT_CONTROL_SERVICE_NAME, handler }, input);

// The definition keeps its handler functions under `service` (not in its public type).
const handlers = (assistantControlService as unknown as { service: unknown }).service as {
  startRun: (ctx: unknown, input: unknown) => Promise<unknown>;
  resolveApproval: (ctx: unknown, input: unknown) => Promise<unknown>;
};

/** The refusal a handler threw, as Restate would see it. */
async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(restate.TerminalError);
  return (error as restate.TerminalError).code;
}

describe('AssistantControl', () => {
  it('refuses an unsigned or wrongly signed call before it reads anything or starts a turn', async () => {
    const turn = await seedTurn();
    const input = { runId: turn.runId };
    for (const headers of [{}, signed('startRun', input, 'a-different-secret-that-is-at-least-32-chars'), signed('resolveApproval', input)]) {
      const { ctx, send } = contextWith(headers);
      expect(await refusal(handlers.startRun(ctx, input))).toBe(401);
      expect(ctx.run).not.toHaveBeenCalled();
      expect(send.processRun).not.toHaveBeenCalled();
    }
  });

  it('refuses input that is not a run id', async () => {
    const { ctx } = contextWith(signed('startRun', { runId: 'nope' }));
    expect(await refusal(handlers.startRun(ctx, { runId: 'nope' }))).toBe(400);
  });

  it('starts a signed run on its conversation’s object, with the user from their account', async () => {
    const turn = await seedTurn();
    const input = { runId: turn.runId };
    const { ctx, send } = contextWith(signed('startRun', input));
    await expect(handlers.startRun(ctx, input)).resolves.toEqual({ status: 'started' });
    expect(ctx.objectSendClient).toHaveBeenCalledWith({ name: 'assistantConversation' }, turn.conversationId);
    // The seeded user has no account row: a neutral placeholder.
    expect(send.processRun).toHaveBeenCalledWith({ runId: turn.runId, user: { name: 'Unknown user', email: '' } });
  });

  it('wakes a run only with a decision saved on the approval', async () => {
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
      return store.insertApproval(tx, { conversationId: turn.conversationId, runId: turn.runId, itemId: item.id, schoolId: turn.schoolId, userId: turn.userId, toolName: 't', awakeableId: 'awk_control' });
    });
    const input = { approvalId: approval.id };

    const pending = contextWith(signed('resolveApproval', input));
    await expect(handlers.resolveApproval(pending.ctx, input)).resolves.toEqual({ status: 'not_decided' });
    expect(pending.ctx.resolveAwakeable).not.toHaveBeenCalled();

    await store.decideApproval(db, approval.id, 'declined');
    const decided = contextWith(signed('resolveApproval', input));
    await expect(handlers.resolveApproval(decided.ctx, input)).resolves.toEqual({ status: 'resolved' });
    expect(decided.ctx.resolveAwakeable).toHaveBeenCalledWith('awk_control', { decision: 'decline' });
  });
});
