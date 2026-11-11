import { randomUUID } from 'node:crypto';

import { assistantConversationAttention, type AssistantRunStatus } from '@campuspilot/assistant-contract/dto';
import { istMonthOf } from '@campuspilot/api/assistant/ist';
import { schoolMonthSpendUsd } from '@campuspilot/api/assistant/spend';
import { getRedisClient } from '@campuspilot/redis/client';
import {
  assistantApprovalTable,
  assistantConversationTable,
  assistantItemTable,
  assistantModelRequestTable,
  assistantRunTable,
  assistantTranscriptEntryTable,
} from '@campuspilot/db/schema/assistant';
import { call, ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { loadAssistantAccess, type AssistantAccessDecision } from './access';
import { db } from './db';
import { configureDispatcher } from './dispatch';
import { generateId } from './ids';
import { assistantRouter } from './router';
import { resolveAssistantSession, type AssistantSession } from './session';
import * as store from './store';
import { seedTurn, type SeededTurn } from './testing/turn';
import { userMessageItemKey } from './transcript';

/**
 * The history list, stopping and deleting a conversation, through the
 * assistant's own router against the real store and Postgres. Only the API's
 * in-process answers are replaced: who the session cookie belongs to
 * (`resolveAssistantSession`) and the API's access decision for that user
 * (`loadAssistantAccess`, itself tested in packages/api).
 */
vi.mock('./session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session')>()),
  resolveAssistantSession: vi.fn(),
}));
/**
 * The API's in-process token issue, replaced so a test can make something
 * happen while it is awaited (the moment a concurrent stop may land).
 */
const tokenIssue = vi.hoisted(() => ({ during: null as null | (() => Promise<void>) }));
vi.mock('@campuspilot/api/assistant/token', () => ({
  issueAssistantRunToken: vi.fn(async () => {
    const during = tokenIssue.during;
    tokenIssue.during = null;
    await during?.();
    return { token: 'delegated-token-for-tests', expiresAt: new Date(Date.now() + 60_000) };
  }),
}));
vi.mock('./access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./access')>()),
  loadAssistantAccess: vi.fn(),
}));

const resolveSessionMock = vi.mocked(resolveAssistantSession);
const loadAccessMock = vi.mocked(loadAssistantAccess);

/** The access decision of a user who may use the assistant. */
const ALLOWED: AssistantAccessDecision = {
  featureEnabled: true,
  member: true,
  allowedRoles: ['principal'],
  limit: { known: true, monthlyLimitUsd: null },
  limitReached: false,
  allowed: true,
  refusal: null,
};

/** A decision refused for one reason, with the facts that reason implies. */
function refusedAccess(code: NonNullable<AssistantAccessDecision['refusal']>['code']): AssistantAccessDecision {
  return {
    ...ALLOWED,
    featureEnabled: code !== 'feature_disabled',
    member: code !== 'feature_disabled' && code !== 'not_member',
    allowedRoles: code === 'limit_reached' ? ['principal'] : [],
    limitReached: code === 'limit_reached',
    allowed: false,
    refusal: { code, message: `Refused: ${code}.` },
  };
}

/** The session cookie of a user, as the fake session lookup reads it back. */
const cookieOf = (userId: string) => `session=${userId}`;

/** A session as the API would resolve it for that cookie. */
function sessionOf(userId: string): AssistantSession {
  return {
    user: { id: userId, name: 'Asha Rao', email: 'asha.rao@school.test', impersonatedBy: null },
    context: {} as AssistantSession['context'],
  };
}

beforeEach(() => {
  resolveSessionMock.mockReset().mockImplementation(async (headers) => {
    const userId = headers.get('cookie')?.replace('session=', '');
    return userId ? sessionOf(userId) : null;
  });
  loadAccessMock.mockReset().mockResolvedValue(ALLOWED);
});

/** Calls a procedure as a signed-in user (or as nobody, without a cookie). */
const as = (userId: string | null) => ({
  context: { headers: new Headers(userId ? { cookie: cookieOf(userId) } : {}) },
});

/** Moves a run to a status, the way the turn loop does (through the store, so events and sequences stay real). */
async function setRunStatus(turn: Pick<SeededTurn, 'conversationId' | 'runId'>, status: AssistantRunStatus) {
  await store.assistantTransaction(db, (tx, emit) =>
    store.updateRun(tx, emit, { id: turn.runId, conversationId: turn.conversationId }, {
      status,
      ...(status === 'queued' ? {} : { startedAt: new Date() }),
      ...(status === 'completed' || status === 'failed' || status === 'cancelled' ? { completedAt: new Date() } : {}),
    }),
  );
}

/** A follow-up message in the same conversation: a newer run, queued, with its user message. */
async function addRun(turn: SeededTurn): Promise<SeededTurn> {
  const runId = generateId('run');
  await store.assistantTransaction(db, async (tx, emit) => {
    await store.insertRun(tx, emit, {
      id: runId,
      conversationId: turn.conversationId,
      schoolId: turn.schoolId,
      userId: turn.userId,
      clientRequestId: randomUUID(),
      surface: 'page',
    });
    await store.insertItem(tx, emit, {
      conversationId: turn.conversationId,
      runId,
      kind: 'user_message',
      status: 'complete',
      body: { text: 'And then?' },
      itemKey: userMessageItemKey(runId),
    });
  });
  return { ...turn, runId, input: { ...turn.input, runId } };
}

/** Another conversation of the same user in the same school, with one queued run. */
async function addConversation(owner: SeededTurn, title: string): Promise<SeededTurn> {
  const conversationId = generateId('conversation');
  await store.assistantTransaction(db, (tx) =>
    store.createConversation(tx, {
      id: conversationId,
      schoolId: owner.schoolId,
      userId: owner.userId,
      title,
      provider: 'anthropic',
      model: 'conversation-start-model',
    }),
  );
  return addRun({ ...owner, conversationId });
}

const list = (turn: Pick<SeededTurn, 'schoolId' | 'userId'>, page = 1) =>
  call(assistantRouter.listConversations, { schoolId: turn.schoolId, page }, as(turn.userId));

const remove = (turn: Pick<SeededTurn, 'schoolId' | 'conversationId'>, userId: string | null) =>
  call(assistantRouter.deleteConversation, { schoolId: turn.schoolId, conversationId: turn.conversationId }, as(userId));

/** How many rows of each kind a conversation still has. */
async function rowsOf(conversationId: string) {
  const count = async (table: typeof assistantRunTable | typeof assistantItemTable | typeof assistantApprovalTable | typeof assistantTranscriptEntryTable) =>
    (await db.select({ id: table.conversationId }).from(table).where(eq(table.conversationId, conversationId))).length;
  const [conversations, runs, items, approvals, transcript] = await Promise.all([
    db.select({ id: assistantConversationTable.id }).from(assistantConversationTable).where(eq(assistantConversationTable.id, conversationId)),
    count(assistantRunTable),
    count(assistantItemTable),
    count(assistantApprovalTable),
    count(assistantTranscriptEntryTable),
  ]);
  return { conversations: conversations.length, runs, items, approvals, transcript };
}

/** A conversation whose only run has ended, with a tool call, a decided approval and transcript entries. */
async function finishedConversationWithEverything() {
  const turn = await seedTurn({ text: 'Rename Class 3 to Grade 3.' });
  await store.assistantTransaction(db, async (tx, emit) => {
    const item = await store.insertItem(tx, emit, {
      conversationId: turn.conversationId,
      runId: turn.runId,
      kind: 'tool_call',
      status: 'succeeded',
      body: { toolUseId: 'tu_1', toolName: 'classes.update', title: 'Update a class', access: 'write', destructive: false, module: 'classes', input: {} },
      itemKey: 'tool:tu_1',
    });
    await store.insertApproval(tx, {
      conversationId: turn.conversationId,
      runId: turn.runId,
      itemId: item.id,
      schoolId: turn.schoolId,
      userId: turn.userId,
      toolName: 'classes.update',
      awakeableId: 'awk_1',
    });
    await store.appendTranscriptEntry(tx, {
      conversationId: turn.conversationId,
      runId: turn.runId,
      role: 'user',
      content: [{ type: 'text', text: 'Rename Class 3 to Grade 3.' }],
      entryKey: 'user:1',
    });
  });
  await setRunStatus(turn, 'completed');
  return turn;
}

describe('a conversation’s attention', () => {
  const EXPECTED: [AssistantRunStatus, 'approval' | 'working' | null][] = [
    ['queued', 'working'],
    ['running', 'working'],
    ['awaiting_approval', 'approval'],
    ['failed', null],
    ['completed', null],
    ['cancelled', null],
  ];

  it.each(EXPECTED)('in the list, a run that is %s gives %s, as the contract’s rule does', async (status, attention) => {
    const turn = await seedTurn();
    if (status !== 'queued') await setRunStatus(turn, status);

    const listed = await list(turn);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ id: turn.conversationId, attention });

    // The open conversation's row is worked out in the browser from the
    // live runs; both must agree.
    const snapshot = await call(assistantRouter.getConversation, { schoolId: turn.schoolId, conversationId: turn.conversationId }, as(turn.userId));
    expect(assistantConversationAttention(snapshot.runs)).toBe(attention);
  });

  it('is null for a conversation that has no run', async () => {
    const owner = await seedTurn();
    const conversationId = generateId('conversation');
    await store.assistantTransaction(db, (tx) =>
      store.createConversation(tx, { id: conversationId, schoolId: owner.schoolId, userId: owner.userId, title: 'Empty', provider: 'anthropic', model: 'm' }),
    );
    const listed = await list(owner);
    expect(listed.items.find((item) => item.id === conversationId)).toMatchObject({ attention: null });
  });

  it('stays on approval while a follow-up is queued behind it', async () => {
    const waiting = await seedTurn();
    await setRunStatus(waiting, 'awaiting_approval');
    await addRun(waiting);
    expect((await list(waiting)).items[0]).toMatchObject({ attention: 'approval' });
  });

  it('stays working while an older run works, whatever newer runs ended as', async () => {
    const working = await seedTurn();
    await setRunStatus(working, 'running');
    const removed = await addRun(working);
    await setRunStatus(removed, 'cancelled');
    expect((await list(working)).items[0]).toMatchObject({ attention: 'working' });

    await setRunStatus(working, 'completed');
    expect((await list(working)).items[0]).toMatchObject({ attention: null });
  });

  it('is given per conversation, for every row of the page, newest conversation first', async () => {
    const waiting = await seedTurn({ text: 'Waiting' });
    await setRunStatus(waiting, 'awaiting_approval');
    const failed = await addConversation(waiting, 'Failed');
    await setRunStatus(failed, 'failed');
    const done = await addConversation(waiting, 'Done');
    await setRunStatus(done, 'completed');
    const working = await addConversation(waiting, 'Working');

    const listed = await list(waiting);
    expect(listed.items.map((item) => [item.title, item.attention])).toEqual([
      ['Working', 'working'],
      ['Done', null],
      ['Failed', null],
      ['Waiting', 'approval'],
    ]);
    expect(listed.pagination).toMatchObject({ totalItems: 4, totalPages: 1, currentPage: 1 });
    expect(working.conversationId).toBe(listed.items[0]?.id);
  });

  it('lists only the signed-in user’s conversations in that school', async () => {
    const mine = await seedTurn();
    const theirs = await seedTurn();
    expect((await list(mine)).items.map((item) => item.id)).toEqual([mine.conversationId]);
    // The same user in another school sees nothing of this one.
    expect((await list({ schoolId: theirs.schoolId, userId: mine.userId })).items).toEqual([]);
  });
});

describe('stopping a run that waits for approval', () => {
  /** A turn waiting on the user's approval of one change. */
  async function waitingForApproval() {
    const turn = await seedTurn({ text: 'Rename Class 3 to Grade 3.' });
    const approval = await store.assistantTransaction(db, async (tx, emit) => {
      const item = await store.insertItem(tx, emit, {
        conversationId: turn.conversationId,
        runId: turn.runId,
        kind: 'tool_call',
        status: 'awaiting_approval',
        body: { toolUseId: 'tu_1', toolName: 'classes.update', title: 'Update a class', access: 'write', destructive: false, module: 'classes', input: {} },
        itemKey: 'tool:tu_1',
      });
      return store.insertApproval(tx, {
        conversationId: turn.conversationId,
        runId: turn.runId,
        itemId: item.id,
        schoolId: turn.schoolId,
        userId: turn.userId,
        toolName: 'classes.update',
        awakeableId: 'awk_waiting',
      });
    });
    await setRunStatus(turn, 'awaiting_approval');
    return { turn, approval };
  }

  it('never approves a change when the stop lands while the approval is being made', async () => {
    const { turn, approval } = await waitingForApproval();
    const resolveApproval = vi.fn().mockResolvedValue(undefined);
    configureDispatcher({ startRun: vi.fn(), resolveApproval });
    onTestFinished(() => configureDispatcher(null));
    // The stop commits after the approve's first stop check, while it awaits the token.
    tokenIssue.during = async () => {
      await store.assistantTransaction(db, async (tx, emit) => {
        const run = await store.lockRun(tx, turn.runId);
        await store.updateRun(tx, emit, run!, { stopRequestedAt: new Date() });
      });
    };

    await expect(
      call(assistantRouter.respondToApproval, { schoolId: turn.schoolId, approvalId: approval.id, decision: 'approve' }, as(turn.userId)),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'The assistant was stopped, so this change will not be made.' });
    expect((await store.findApproval(db, approval.id))?.status).toBe('pending');
    expect(resolveApproval).not.toHaveBeenCalled();

    // The stop then cancels it, as it would have.
    await call(assistantRouter.stopRun, { schoolId: turn.schoolId, runId: turn.runId }, as(turn.userId));
    expect((await store.findApproval(db, approval.id))?.status).toBe('cancelled');
  });

  it('cancels the approval for good even when the worker cannot be reached, and the outbox wakes the run later', async () => {
    const { turn, approval } = await waitingForApproval();
    const resolveApproval = vi.fn().mockRejectedValueOnce(new Error('Restate is unreachable')).mockResolvedValue(undefined);
    configureDispatcher({ startRun: vi.fn(), resolveApproval });
    onTestFinished(() => configureDispatcher(null));
    const stop = () => call(assistantRouter.stopRun, { schoolId: turn.schoolId, runId: turn.runId }, as(turn.userId));

    await expect(stop()).resolves.toMatchObject({ id: turn.runId });
    const cancelled = await store.findApproval(db, approval.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', resolutionHandedOverAt: null, resolutionHandoverAttempts: 1 });
    expect(cancelled?.lastResolutionHandoverError).toBe('Restate is unreachable.');
    await expect(
      call(assistantRouter.respondToApproval, { schoolId: turn.schoolId, approvalId: approval.id, decision: 'approve' }, as(turn.userId)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Pressing Stop again hands the saved cancel over once more.
    await expect(stop()).resolves.toMatchObject({ id: turn.runId });
    expect(resolveApproval).toHaveBeenCalledTimes(2);
    expect(resolveApproval).toHaveBeenLastCalledWith({ approvalId: approval.id });
    expect(await store.findApproval(db, approval.id)).toMatchObject({ status: 'cancelled', resolutionHandoverAttempts: 2 });
    expect((await store.findApproval(db, approval.id))?.resolutionHandedOverAt).toBeInstanceOf(Date);
  });
});

describe('deleting a conversation', () => {
  it('is soft: every row stays, marked deleted by its user, and nothing else changes', async () => {
    const turn = await finishedConversationWithEverything();
    const other = await addConversation(turn, 'Keep me');
    await setRunStatus(other, 'completed');
    expect(await rowsOf(turn.conversationId)).toEqual({ conversations: 1, runs: 1, items: 2, approvals: 1, transcript: 1 });

    await expect(remove(turn, turn.userId)).resolves.toEqual({ id: turn.conversationId });

    expect(await rowsOf(turn.conversationId)).toEqual({ conversations: 1, runs: 1, items: 2, approvals: 1, transcript: 1 });
    const [deleted] = await db.select().from(assistantConversationTable).where(eq(assistantConversationTable.id, turn.conversationId));
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(deleted?.deletedBy).toBe(turn.userId);
    const [kept] = await db.select().from(assistantConversationTable).where(eq(assistantConversationTable.id, other.conversationId));
    expect(kept?.deletedAt).toBeNull();
    expect((await list(turn)).items.map((item) => item.id)).toEqual([other.conversationId]);
    expect((await list(turn)).pagination.totalItems).toBe(1);
  });

  it('makes the conversation not found for every procedure', async () => {
    const turn = await finishedConversationWithEverything();
    const approval = (await db.select().from(assistantApprovalTable).where(eq(assistantApprovalTable.runId, turn.runId)))[0]!;
    const run = await store.findRun(db, turn.runId);
    await remove(turn, turn.userId);
    const ids = { schoolId: turn.schoolId, conversationId: turn.conversationId };

    // Called one at a time, so no refusal is left unobserved.
    const attempts: Array<() => Promise<unknown>> = [
      () => call(assistantRouter.getConversation, ids, as(turn.userId)),
      async () => {
        const events = await call(assistantRouter.subscribeConversation, ids, as(turn.userId));
        await events.next();
      },
      () => call(assistantRouter.sendMessage, { ...ids, clientRequestId: randomUUID(), text: 'More?', surface: 'page' }, as(turn.userId)),
      // The replay of the message that started it.
      () => call(assistantRouter.sendMessage, { ...ids, clientRequestId: run!.clientRequestId, text: 'x', surface: 'page' }, as(turn.userId)),
      () => call(assistantRouter.respondToApproval, { schoolId: turn.schoolId, approvalId: approval.id, decision: 'decline' }, as(turn.userId)),
      () => call(assistantRouter.stopRun, { schoolId: turn.schoolId, runId: turn.runId }, as(turn.userId)),
      () => remove(turn, turn.userId),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['queued', 'running', 'awaiting_approval'] as const)(
    'is refused while a run is %s, and deletes nothing',
    async (status) => {
      const turn = await seedTurn();
      if (status !== 'queued') await setRunStatus(turn, status);

      const refusal = await remove(turn, turn.userId).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(ORPCError);
      expect(refusal).toMatchObject({ code: 'CONFLICT', message: 'Stop the assistant before deleting this conversation.' });
      expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1, runs: 1, items: 1 });
    },
  );

  it('is refused while an older run has ended but a newer one waits in the queue', async () => {
    const first = await seedTurn();
    await setRunStatus(first, 'completed');
    await addRun(first);
    await expect(remove(first, first.userId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await rowsOf(first.conversationId)).toMatchObject({ conversations: 1, runs: 2 });
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('is allowed once its run has %s', async (status) => {
    const turn = await seedTurn();
    await setRunStatus(turn, status);
    await expect(remove(turn, turn.userId)).resolves.toEqual({ id: turn.conversationId });
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1, runs: 1, items: 1 });
    expect((await list(turn)).items).toEqual([]);
  });

  it('answers “not found” for someone else’s conversation, and leaves it alone', async () => {
    const turn = await finishedConversationWithEverything();
    await expect(remove(turn, `usr_${randomUUID()}`)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // The owner, but through another school.
    await expect(remove({ schoolId: `sch_${randomUUID()}`, conversationId: turn.conversationId }, turn.userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1, runs: 1 });
  });

  it('is refused for a user who is no longer a member of the school', async () => {
    const turn = await finishedConversationWithEverything();
    loadAccessMock.mockResolvedValue(refusedAccess('not_member'));
    await expect(remove(turn, turn.userId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(loadAccessMock).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: turn.userId }) }), turn.schoolId);
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1 });
  });

  it('is refused for a user whose role was switched off, and keeps the conversation', async () => {
    const turn = await finishedConversationWithEverything();
    loadAccessMock.mockResolvedValue(refusedAccess('role_not_enabled'));
    await expect(remove(turn, turn.userId)).rejects.toMatchObject({ code: 'FORBIDDEN', data: { reason: 'role_not_enabled' } });
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1 });
  });

  it('keeps the saved costs of its model requests linked to their run, so the month’s spend does not drop', async () => {
    const turn = await finishedConversationWithEverything();
    await store.assistantTransaction(db, (tx) =>
      store.recordModelRequest(tx, {
        runId: turn.runId,
        schoolId: turn.schoolId,
        userId: turn.userId,
        requestKey: `${turn.runId}:model:0`,
        provider: 'gemini',
        requestedModel: 'm',
        answeredModel: 'm',
        usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        usageComplete: true,
        prices: { inputUsdPerMtok: '0.75', outputUsdPerMtok: '3.75', cacheReadUsdPerMtok: '0.075', cacheWriteUsdPerMtok: '0' },
      }),
    );
    const monthKey = `assistant:spend:${turn.schoolId}:${istMonthOf(new Date()).month}`;
    await getRedisClient().del(monthKey);
    expect(await schoolMonthSpendUsd(db, turn.schoolId)).toBe('0.75000000');

    await expect(remove(turn, turn.userId)).resolves.toEqual({ id: turn.conversationId });

    const kept = await db.select().from(assistantModelRequestTable).where(eq(assistantModelRequestTable.schoolId, turn.schoolId));
    expect(kept).toMatchObject([{ runId: turn.runId, userId: turn.userId, costUsd: '0.75000000', inputTokens: 1_000_000 }]);
    // A run with costs cannot be hard-deleted: the costs would be dropped or unlinked.
    await expect(db.delete(assistantRunTable).where(eq(assistantRunTable.id, turn.runId))).rejects.toThrow();
    await getRedisClient().del(monthKey);
    expect(await schoolMonthSpendUsd(db, turn.schoolId)).toBe('0.75000000');
  });

  it('is refused without a session', async () => {
    const turn = await finishedConversationWithEverything();
    await expect(remove(turn, null)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1 });
  });

  it('answers “not found” the second time', async () => {
    const turn = await finishedConversationWithEverything();
    await remove(turn, turn.userId);
    await expect(remove(turn, turn.userId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('access', () => {
  const send = (turn: Pick<SeededTurn, 'schoolId' | 'userId'>) =>
    call(
      assistantRouter.sendMessage,
      { schoolId: turn.schoolId, clientRequestId: randomUUID(), text: 'How many students?', surface: 'panel' },
      as(turn.userId),
    );

  it('makes everything disappear while the school does not have the feature', async () => {
    const turn = await seedTurn();
    loadAccessMock.mockResolvedValue(refusedAccess('feature_disabled'));
    for (const attempt of [
      list(turn),
      call(assistantRouter.getStatus, { schoolId: turn.schoolId }, as(turn.userId)),
      call(assistantRouter.getConversation, { schoolId: turn.schoolId, conversationId: turn.conversationId }, as(turn.userId)),
      send(turn),
    ]) {
      const error = await attempt.catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'assistant' } });
    }
    // Nothing was deleted: the conversations come back with the feature.
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1, runs: 1 });
  });

  it('makes everything disappear for a user whose role is not switched on, except the status that says so', async () => {
    const turn = await seedTurn();
    loadAccessMock.mockResolvedValue(refusedAccess('role_not_enabled'));
    for (const attempt of [
      list(turn),
      call(assistantRouter.getConversation, { schoolId: turn.schoolId, conversationId: turn.conversationId }, as(turn.userId)),
      call(assistantRouter.stopRun, { schoolId: turn.schoolId, runId: turn.runId }, as(turn.userId)),
      remove(turn, turn.userId),
      send(turn),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: 'FORBIDDEN', data: { reason: 'role_not_enabled' } });
    }
    await expect(call(assistantRouter.getStatus, { schoolId: turn.schoolId }, as(turn.userId))).resolves.toEqual({
      configured: true,
      allowed: false,
      available: false,
      unavailableReason: 'Refused: role_not_enabled.',
    });
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1, runs: 1 });
  });

  it('does not replay a sent message to a user who may no longer see the assistant', async () => {
    const turn = await seedTurn();
    const run = await store.findRun(db, turn.runId);
    loadAccessMock.mockResolvedValue(refusedAccess('role_not_enabled'));
    await expect(
      call(
        assistantRouter.sendMessage,
        { schoolId: turn.schoolId, clientRequestId: run!.clientRequestId, text: 'How many students?', surface: 'panel' },
        as(turn.userId),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', data: { reason: 'role_not_enabled' } });
  });

  it('keeps the assistant and its history visible but refuses a new message once the school reached its monthly limit', async () => {
    const turn = await seedTurn();
    loadAccessMock.mockResolvedValue(refusedAccess('limit_reached'));
    await expect(list(turn)).resolves.toMatchObject({ pagination: { totalItems: 1 } });
    await expect(call(assistantRouter.stopRun, { schoolId: turn.schoolId, runId: turn.runId }, as(turn.userId))).resolves.toMatchObject({
      id: turn.runId,
    });
    await expect(call(assistantRouter.getStatus, { schoolId: turn.schoolId }, as(turn.userId))).resolves.toEqual({
      configured: true,
      allowed: true,
      available: false,
      unavailableReason: 'Refused: limit_reached.',
    });
    await expect(send(turn)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', data: { reason: 'limit_reached' } });
  });

  it('reports a user who may use it as allowed and available', async () => {
    const turn = await seedTurn();
    await expect(call(assistantRouter.getStatus, { schoolId: turn.schoolId }, as(turn.userId))).resolves.toEqual({
      configured: true,
      allowed: true,
      available: true,
      unavailableReason: null,
    });
  });
});
