import { randomUUID } from 'node:crypto';

import { assistantConversationAttention, type AssistantRunStatus } from '@campuspilot/assistant-contract/dto';
import { istMonthOf } from '@campuspilot/api/assistant/ist';
import { schoolMonthSpendUsd } from '@campuspilot/api/assistant/spend';
import { getRedisClient } from '@campuspilot/redis/client';
import {
  assistantApprovalTable,
  assistantAttachmentTable,
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
import { createAttachment, deleteConversationAttachments, deleteUnsentAttachment, loadAttachmentFile, sweepUnsentAttachments } from './attachments';
import { handleAssistantAttachmentRead, handleAssistantAttachmentUpload } from './attachments.http';
import { getObjectBytes, pageImageUrl, putObject } from '@campuspilot/api/routers/school/question-paper/question-paper.storage';
import { makeImageDerivatives } from '@campuspilot/api/files/image-derivative';
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
/** Object storage is not part of this test project; attachment rows are enough for the router. */
const storage = vi.hoisted(() => ({ deleted: [] as string[], failing: false }));
/** The paper a seed names exists only when its session id is `ss` (the real lookup is tested with the question paper procedures). */
vi.mock('@campuspilot/api/routers/school/question-paper/question-paper.scope', () => ({
  resolvePaperScope: vi.fn(async (_db: unknown, key: { sessionId: string }) => {
    if (key.sessionId !== 'ss') {
      const { ORPCError } = await import('@orpc/server');
      throw new ORPCError('NOT_FOUND', { message: 'School session was not found.' });
    }
    return {};
  }),
}));
vi.mock('@campuspilot/api/files/image-derivative', () => ({
  makeImageDerivatives: vi.fn(async () => ({
    status: 'ready',
    width: 1,
    height: 1,
    model: { bytes: Buffer.from('m'), contentType: 'image/jpeg' },
    thumb: { bytes: Buffer.from('t'), contentType: 'image/jpeg' },
  })),
}));
vi.mock('@campuspilot/api/routers/school/question-paper/question-paper.storage', () => ({
  deleteObjects: vi.fn(async (keys: Array<string | null>) => {
    if (storage.failing) throw new Error('storage down');
    storage.deleted.push(...keys.filter((key): key is string => Boolean(key)));
  }),
  deleteObjectsBestEffort: vi.fn(async (keys: Array<string | null>) => {
    storage.deleted.push(...keys.filter((key): key is string => Boolean(key)));
  }),
  getObjectBytes: vi.fn(),
  putObject: vi.fn(),
  pageImageUrl: vi.fn(),
  QUESTION_PAPER_IMAGE_CACHE_SECONDS: 240,
}));
/**
 * The API's OPA check, replaced by a table of the class permissions each test
 * user holds (the real check is tested with the API's permissions). Only the
 * question paper permissions of a conversation shared with a paper ask it.
 */
const permissions = vi.hoisted(() => ({ byUser: new Map<string, Set<string>>() }));
vi.mock('@campuspilot/api/permissions/authorization', async () => {
  const { ORPCError } = await import('@orpc/server');
  const holds = (context: { session?: { user: { id: string } } }, action: string) => permissions.byUser.get(context.session?.user.id ?? '')?.has(action) ?? false;
  return {
    checkPermissions: vi.fn(async (context: { session?: { user: { id: string } } }, requests: { action: string }[]) => requests.map((request) => holds(context, request.action))),
    assertPermission: vi.fn(async (context: { session?: { user: { id: string } } }, request: { action: string }) => {
      if (!holds(context, request.action)) throw new ORPCError('FORBIDDEN', { message: 'You do not have permission to perform this action.' });
    }),
  };
});
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
    // Only who the user is: the permission check above reads nothing else.
    context: { session: { user: { id: userId } } } as unknown as AssistantSession['context'],
  };
}

beforeEach(() => {
  resolveSessionMock.mockReset().mockImplementation(async (headers) => {
    const userId = headers.get('cookie')?.replace('session=', '');
    return userId ? sessionOf(userId) : null;
  });
  loadAccessMock.mockReset().mockResolvedValue(ALLOWED);
  permissions.byUser.clear();
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

describe('images attached to a message', () => {
  /** An uploaded, unsent attachment of a user (its row; the router never reads the object). */
  async function upload(owner: { schoolId: string; userId: string }, name: string, overrides: Partial<typeof assistantAttachmentTable.$inferInsert> = {}) {
    const attachmentId = `asat_${randomUUID().replaceAll('-', '').slice(0, 21)}`;
    await db.insert(assistantAttachmentTable).values({
      id: attachmentId,
      schoolId: owner.schoolId,
      userId: owner.userId,
      kind: 'image',
      originalName: name,
      contentType: 'image/jpeg',
      byteSize: 100,
      sha256: 'x',
      width: 10,
      height: 10,
      s3Key: `schools/${owner.schoolId}/assistant/attachments/${attachmentId}/original.jpg`,
      derivativeStatus: 'ready',
      thumbS3Key: `schools/${owner.schoolId}/assistant/attachments/${attachmentId}/thumb.jpg`,
      modelS3Key: `schools/${owner.schoolId}/assistant/attachments/${attachmentId}/model.jpg`,
      modelContentType: 'image/jpeg',
      ...overrides,
    });
    return attachmentId;
  }
  const rowOf = async (id: string) => (await db.select().from(assistantAttachmentTable).where(eq(assistantAttachmentTable.id, id)))[0];

  const startConversation = (owner: { schoolId: string; userId: string }, extra: Record<string, unknown>) => {
    configureDispatcher({ startRun: vi.fn(), resolveApproval: vi.fn() });
    onTestFinished(() => configureDispatcher(null));
    return call(
      assistantRouter.sendMessage,
      { schoolId: owner.schoolId, clientRequestId: randomUUID(), surface: 'page', text: '', ...extra },
      as(owner.userId),
    );
  };

  async function newOwner() {
    const turn = await seedTurn();
    return { schoolId: turn.schoolId, userId: turn.userId };
  }

  it('binds the images to the message in the order sent, in the transaction that saves it', async () => {
    const owner = await newOwner();
    const [a, b, c] = [await upload(owner, 'page1.jpg'), await upload(owner, 'page2.jpg'), await upload(owner, 'page3.jpg')];

    const sent = await startConversation(owner, { text: 'Read these', attachmentIds: [c, a, b] });

    expect(sent.item.body.attachments?.map((attachment) => [attachment.id, attachment.fileName, attachment.previewable])).toEqual([
      [c, 'page3.jpg', true],
      [a, 'page1.jpg', true],
      [b, 'page2.jpg', true],
    ]);
    for (const [index, id] of [c, a, b].entries()) {
      expect(await rowOf(id)).toMatchObject({ conversationId: sent.conversation.id, itemId: sent.item.id, position: index + 1 });
      expect((await rowOf(id))?.attachedAt).toBeInstanceOf(Date);
    }
    // Images only is a message too, titled after what it carries.
    const imagesOnly = await startConversation(owner, { attachmentIds: [await upload(owner, 'solo.jpg')] });
    expect(imagesOnly.conversation.title).toBe('Attached image');
  });

  it('refuses the whole message when one image is not the sender’s, is already sent or is gone, and saves nothing', async () => {
    const owner = await newOwner();
    const stranger = await newOwner();
    const mine = await upload(owner, 'mine.jpg');
    const theirs = await upload(stranger, 'theirs.jpg');
    const before = await list(owner);

    await expect(startConversation(owner, { text: 'x', attachmentIds: [mine, theirs] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(startConversation(owner, { text: 'x', attachmentIds: [mine, 'asat_missing000000000000'] })).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'attachments_missing', attachmentIds: ['asat_missing000000000000'] } });
    expect((await list(owner)).pagination.totalItems).toBe(before.pagination.totalItems);
    expect(await rowOf(mine)).toMatchObject({ itemId: null, conversationId: null });

    await startConversation(owner, { text: 'first', attachmentIds: [mine] });
    await expect(startConversation(owner, { text: 'again', attachmentIds: [mine] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('returns the original message when the same request is sent again, without binding anything twice', async () => {
    const owner = await newOwner();
    const id = await upload(owner, 'once.jpg');
    const clientRequestId = randomUUID();
    const first = await startConversation(owner, { text: 'x', attachmentIds: [id], clientRequestId });
    const again = await startConversation(owner, { text: 'x', attachmentIds: [id], clientRequestId });
    expect(again.item.id).toBe(first.item.id);
    expect(again.item.body.attachments).toHaveLength(1);
    expect(await rowOf(id)).toMatchObject({ itemId: first.item.id, position: 1 });
  });

  it('keeps the screen a conversation started from on its first message', async () => {
    const owner = await newOwner();
    const seed = { kind: 'question_paper', sessionId: 'ss', examSlug: 'half-yearly', classId: 'cl', subjectSlug: 'science', modeSlug: 'theory' };
    const sent = await startConversation(owner, { text: 'I want to update this question paper: add one', seed });
    expect(sent.item.body.seed).toEqual(seed);
  });

  it('refuses a seed that names no paper of the school, before anything is saved', async () => {
    const owner = await newOwner();
    const before = await list(owner);
    const seed = { kind: 'question_paper', sessionId: 'other', examSlug: 'half-yearly', classId: 'cl', subjectSlug: 'science', modeSlug: 'theory' };
    await expect(startConversation(owner, { text: 'x', seed })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('was not found') });
    expect((await list(owner)).pagination.totalItems).toBe(before.pagination.totalItems);
  });

  it('sweeps images never sent after a day, and keeps sent and recent ones', async () => {
    const owner = await newOwner();
    const old = await upload(owner, 'old.jpg', { createdAt: new Date(Date.now() - 25 * 3_600_000) });
    const recent = await upload(owner, 'recent.jpg');
    const sent = await startConversation(owner, { text: 'x', attachmentIds: [await upload(owner, 'sent.jpg', { createdAt: new Date(Date.now() - 48 * 3_600_000) })] });
    storage.deleted.length = 0;

    await sweepUnsentAttachments(db);

    expect(await rowOf(old)).toBeUndefined();
    expect(storage.deleted).toEqual(expect.arrayContaining([expect.stringContaining(old)]));
    expect(await rowOf(recent)).toBeDefined();
    expect(await rowOf(sent.item.body.attachments![0]!.id)).toBeDefined();
  });

  it('deletes a conversation’s images with it', async () => {
    const owner = await newOwner();
    const id = await upload(owner, 'bye.jpg');
    const sent = await startConversation(owner, { text: 'x', attachmentIds: [id] });
    await setRunStatus({ conversationId: sent.conversation.id, runId: sent.run.id }, 'completed');
    storage.deleted.length = 0;

    await remove({ schoolId: owner.schoolId, conversationId: sent.conversation.id }, owner.userId);

    expect(await rowOf(id)).toBeUndefined();
    expect(storage.deleted.some((key) => key.includes(id))).toBe(true);
  });

  it('removes an unsent image of its owner with its objects, and nothing that is sent or someone else’s', async () => {
    const owner = await newOwner();
    const stranger = await newOwner();
    const wrong = await upload(owner, 'wrong.jpg');
    storage.deleted.length = 0;
    await expect(deleteUnsentAttachment(db, { ...owner, attachmentId: wrong })).resolves.toEqual({ deleted: true });
    expect(await rowOf(wrong)).toBeUndefined();
    expect(storage.deleted).toHaveLength(3);
    // Removing it again, or an image that never existed, is harmless.
    await expect(deleteUnsentAttachment(db, { ...owner, attachmentId: wrong })).resolves.toEqual({ deleted: false });

    const theirs = await upload(stranger, 'theirs.jpg');
    await expect(deleteUnsentAttachment(db, { ...owner, attachmentId: theirs })).resolves.toEqual({ deleted: false });
    expect(await rowOf(theirs)).toBeDefined();
    // Its own owner can remove it.
    await expect(deleteUnsentAttachment(db, { schoolId: stranger.schoolId, userId: stranger.userId, attachmentId: theirs })).resolves.toEqual({ deleted: true });

    const sentId = await upload(owner, 'sent.jpg');
    await startConversation(owner, { text: 'x', attachmentIds: [sentId] });
    await expect(deleteUnsentAttachment(db, { ...owner, attachmentId: sentId })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await rowOf(sentId)).toBeDefined();
  });

  it('keeps the row when its objects cannot be deleted, so a later sweep can retry', async () => {
    const owner = await newOwner();
    const stuck = await upload(owner, 'stuck.jpg', { createdAt: new Date(Date.now() - 25 * 3_600_000) });
    storage.failing = true;
    try {
      await expect(deleteUnsentAttachment(db, { ...owner, attachmentId: stuck })).rejects.toBeDefined();
      await sweepUnsentAttachments(db);
      expect(await rowOf(stuck)).toBeDefined();
    } finally {
      storage.failing = false;
    }
    await sweepUnsentAttachments(db);
    expect(await rowOf(stuck)).toBeUndefined();
  });

  it('retries the objects of a deleted conversation whose cleanup failed', async () => {
    const owner = await newOwner();
    const id = await upload(owner, 'bye.jpg');
    const sent = await startConversation(owner, { text: 'x', attachmentIds: [id] });
    await setRunStatus({ conversationId: sent.conversation.id, runId: sent.run.id }, 'completed');
    storage.failing = true;
    try {
      await remove({ schoolId: owner.schoolId, conversationId: sent.conversation.id }, owner.userId);
      expect(await rowOf(id)).toBeDefined();
    } finally {
      storage.failing = false;
    }
    await sweepUnsentAttachments(db);
    expect(await rowOf(id)).toBeUndefined();
  });

  it('frees images left behind by a reload when the user hits the cap, and keeps recent ones', async () => {
    const owner = await newOwner();
    const file = { bytes: Buffer.from('jpeg'), kind: 'image' as const, contentType: 'image/jpeg', extension: 'jpg', name: 'p.jpg' };
    const hourAgo = new Date(Date.now() - 2 * 3_600_000);
    const left = await Promise.all(Array.from({ length: 40 }, (_, index) => upload(owner, `left${index}.jpg`, { createdAt: hourAgo })));
    await expect(createAttachment(db, { ...owner, file })).resolves.toMatchObject({ fileName: 'p.jpg' });
    expect(await rowOf(left[0]!)).toBeUndefined();

    // Fresh images are kept as long as they could be in an open composer: only those beyond the newest 20 go.
    const busy = await newOwner();
    const open = await Promise.all(Array.from({ length: 40 }, (_, index) => upload(busy, `open${index}.jpg`, { createdAt: new Date(Date.now() - (40 - index) * 1_000) })));
    await expect(createAttachment(db, { ...busy, file })).resolves.toMatchObject({ fileName: 'p.jpg' });
    expect(await Promise.all(open.map(async (id) => (await rowOf(id)) !== undefined))).toEqual([...Array.from({ length: 20 }, () => false), ...Array.from({ length: 20 }, () => true)]);
  });
});

describe('PDF attachments', () => {
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  async function newOwner() {
    const turn = await seedTurn();
    return { schoolId: turn.schoolId, userId: turn.userId };
  }
  const rowOf = async (id: string) => (await db.select().from(assistantAttachmentTable).where(eq(assistantAttachmentTable.id, id)))[0];

  /** Posts one file to the upload route as the composer does. */
  async function post(owner: { schoolId: string; userId: string }, bytes: Buffer, name: string, type = 'application/octet-stream') {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes)], { type }), name);
    const response = await handleAssistantAttachmentUpload(
      new Request('http://api.invalid/upload', { method: 'POST', body: form, headers: { cookie: cookieOf(owner.userId), origin: 'http://management.invalid' } }),
      owner.schoolId,
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const read = (owner: { schoolId: string; userId: string }, attachmentId: string, variant: string) =>
    handleAssistantAttachmentRead(new Headers({ cookie: cookieOf(owner.userId) }), { schoolId: owner.schoolId, attachmentId, variant });

  const send = (owner: { schoolId: string; userId: string }, extra: Record<string, unknown>) => {
    configureDispatcher({ startRun: vi.fn(), resolveApproval: vi.fn() });
    onTestFinished(() => configureDispatcher(null));
    return call(assistantRouter.sendMessage, { schoolId: owner.schoolId, clientRequestId: randomUUID(), surface: 'page', text: '', ...extra }, as(owner.userId));
  };

  it('stores a PDF as it is, with no derivatives, keyed by its own id and decided by its bytes', async () => {
    const owner = await newOwner();
    vi.mocked(putObject).mockClear();
    vi.mocked(makeImageDerivatives).mockClear();

    const uploaded = await post(owner, PDF, 'Exam paper.png', 'image/png');

    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({ kind: 'document', contentType: 'application/pdf', fileName: 'Exam paper.png', width: null, height: null, previewable: false, byteSize: PDF.byteLength });
    const row = (await rowOf(uploaded.body.id as string))!;
    expect(row).toMatchObject({ kind: 'document', derivativeStatus: null, thumbS3Key: null, modelS3Key: null, modelContentType: null });
    expect(row.s3Key).toBe(`schools/${owner.schoolId}/assistant/attachments/${row.id}/original.pdf`);
    // The bytes are stored exactly as uploaded; nothing was decoded or derived.
    expect(vi.mocked(putObject).mock.calls).toEqual([[row.s3Key, PDF, 'application/pdf']]);
    expect(makeImageDerivatives).not.toHaveBeenCalled();
  });

  it('takes an image named .pdf as an image, and refuses HTML named .pdf with the save-as-PDF sentence', async () => {
    const owner = await newOwner();
    const image = await post(owner, JPEG, 'scan.pdf', 'application/pdf');
    expect(image.body).toMatchObject({ kind: 'image', contentType: 'image/jpeg' });
    expect((await rowOf(image.body.id as string))!.s3Key.endsWith('/original.jpg')).toBe(true);

    const html = await post(owner, Buffer.from('<html><script>alert(1)</script></html>'), 'paper.pdf', 'application/pdf');
    expect(html.status).toBe(415);
    expect(html.body.message).toMatch(/Save Word and other documents as PDF/);
  });

  it('never returns a document from the image routes, in either variant', async () => {
    const owner = await newOwner();
    vi.mocked(pageImageUrl).mockResolvedValue('https://storage.invalid/signed');
    const doc = (await post(owner, PDF, 'paper.pdf')).body.id as string;
    vi.mocked(pageImageUrl).mockClear();
    for (const variant of ['thumb', 'original']) {
      const response = await read(owner, doc, variant);
      expect(response.status).toBe(404);
      expect(response.headers.get('location')).toBeNull();
    }
    expect(pageImageUrl).not.toHaveBeenCalled();
    // An image of the same user still redirects.
    const image = (await post(owner, JPEG, 'p.jpg')).body.id as string;
    expect((await read(owner, image, 'thumb')).status).toBe(302);
  });

  it('sends a PDF with a message, titles the chat after it and loads it for the model as the PDF itself', async () => {
    const owner = await newOwner();
    const doc = (await post(owner, PDF, 'paper.pdf')).body.id as string;
    const sent = await send(owner, { attachmentIds: [doc] });
    expect(sent.conversation.title).toBe('Attached PDF');
    expect(sent.item.body.attachments).toEqual([expect.objectContaining({ id: doc, kind: 'document', previewable: false })]);

    vi.mocked(getObjectBytes).mockResolvedValueOnce(Buffer.from(PDF));
    expect(await loadAttachmentFile(doc, { image: ['image/jpeg'], document: ['application/pdf'] }, db)).toEqual({ kind: 'document', bytes: Buffer.from(PDF), mimeType: 'application/pdf' });
    // A provider that reads no documents gets "unreadable", which the context turns into a note.
    expect(await loadAttachmentFile(doc, { image: ['image/jpeg'], document: [] }, db)).toEqual({ kind: 'unreadable' });
  });

  it('counts PDFs toward the unsent cap and removes them with their object, unsent, swept or with their conversation', async () => {
    const owner = await newOwner();
    const unsent = (await post(owner, PDF, 'wrong.pdf')).body.id as string;
    storage.deleted.length = 0;
    await expect(deleteUnsentAttachment(db, { ...owner, attachmentId: unsent })).resolves.toEqual({ deleted: true });
    expect(await rowOf(unsent)).toBeUndefined();
    expect(storage.deleted).toEqual([`schools/${owner.schoolId}/assistant/attachments/${unsent}/original.pdf`]);

    const stale = (await post(owner, PDF, 'old.pdf')).body.id as string;
    await db.update(assistantAttachmentTable).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(assistantAttachmentTable.id, stale));
    storage.deleted.length = 0;
    await sweepUnsentAttachments(db);
    expect(await rowOf(stale)).toBeUndefined();
    expect(storage.deleted).toContain(`schools/${owner.schoolId}/assistant/attachments/${stale}/original.pdf`);

    const kept = (await post(owner, PDF, 'kept.pdf')).body.id as string;
    const sent = await send(owner, { text: 'read', attachmentIds: [kept] });
    storage.deleted.length = 0;
    await deleteConversationAttachments(db, sent.conversation.id);
    expect(await rowOf(kept)).toBeUndefined();
    expect(storage.deleted).toEqual([`schools/${owner.schoolId}/assistant/attachments/${kept}/original.pdf`]);
  });

  it('holds the database to one shape per kind', async () => {
    const owner = await newOwner();
    const id = `asat_${randomUUID().replaceAll('-', '').slice(0, 21)}`;
    const base = { id, schoolId: owner.schoolId, userId: owner.userId, originalName: 'x.pdf', byteSize: 1, sha256: 'x', s3Key: `schools/${owner.schoolId}/assistant/attachments/${id}/original.pdf` };
    // A document with a derivative status, a thumbnail or another type is refused; an image without a status too.
    await expect(db.insert(assistantAttachmentTable).values({ ...base, kind: 'document', contentType: 'application/pdf', derivativeStatus: 'unsupported' })).rejects.toThrow();
    await expect(db.insert(assistantAttachmentTable).values({ ...base, kind: 'document', contentType: 'text/html', derivativeStatus: null })).rejects.toThrow();
    await expect(db.insert(assistantAttachmentTable).values({ ...base, kind: 'image', contentType: 'image/jpeg', derivativeStatus: null })).rejects.toThrow();
    await expect(db.insert(assistantAttachmentTable).values({ ...base, kind: 'document', contentType: 'application/pdf', derivativeStatus: null })).resolves.toBeDefined();
  });
});

describe('conversations shared with a question paper', () => {
  const READ = 'class.exam.question_paper.read';
  const MANAGE = 'class.exam.question_paper.manage';
  /** The paper the mocked scope lookup knows (its session id is `ss`). */
  const PAPER = { sessionId: 'ss', examSlug: 'final', classId: 'cls_paper', subjectSlug: 'maths', modeSlug: 'theory' };
  const grant = (userId: string, ...actions: string[]) => permissions.byUser.set(userId, new Set(actions));
  const user = () => `usr_${randomUUID()}`;

  /** A message sent as `userId`, starting a conversation (with `extra`) or continuing one. */
  function send(schoolId: string, userId: string, extra: Record<string, unknown>) {
    configureDispatcher({ startRun: vi.fn(), resolveApproval: vi.fn() });
    onTestFinished(() => configureDispatcher(null));
    return call(assistantRouter.sendMessage, { schoolId, clientRequestId: randomUUID(), surface: 'panel', text: 'Make it easier.', ...extra }, as(userId));
  }
  /** A conversation the first teacher starts on the paper's screen, shared with the paper. */
  async function sharedConversation() {
    const owner = await seedTurn();
    grant(owner.userId, READ, MANAGE);
    const started = await send(owner.schoolId, owner.userId, { seed: { kind: 'question_paper', ...PAPER }, shareWithPaper: true });
    return { schoolId: owner.schoolId, ownerId: owner.userId, conversationId: started.conversation.id, runId: started.run.id, started };
  }
  const get = (schoolId: string, conversationId: string, userId: string) =>
    call(assistantRouter.getConversation, { schoolId, conversationId }, as(userId));
  const history = (schoolId: string, userId: string, paper = PAPER) =>
    call(assistantRouter.listPaperConversations, { schoolId, ...paper, page: 1 }, as(userId));

  it('is shared only when asked, by someone who may change the paper', async () => {
    const shared = await sharedConversation();
    expect(shared.started.conversation).toMatchObject({ sharedWithPaper: true, userId: shared.ownerId });
    expect(shared.started.item.body.author).toEqual({ userId: shared.ownerId, name: 'Asha Rao' });

    // A seed alone keeps the conversation private.
    const privately = await send(shared.schoolId, shared.ownerId, { seed: { kind: 'question_paper', ...PAPER } });
    expect(privately.conversation.sharedWithPaper).toBe(false);

    // Someone who may only read the paper cannot start one shared with it.
    const reader = user();
    grant(reader, READ);
    await expect(send(shared.schoolId, reader, { seed: { kind: 'question_paper', ...PAPER }, shareWithPaper: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('is read by whoever may read the paper, and continued only by whoever may change it', async () => {
    const shared = await sharedConversation();
    const [reader, colleague, stranger] = [user(), user(), user()];
    grant(reader, READ);
    grant(colleague, READ, MANAGE);

    await expect(get(shared.schoolId, shared.conversationId, reader)).resolves.toMatchObject({ conversation: { id: shared.conversationId } });
    await expect(get(shared.schoolId, shared.conversationId, stranger)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(send(shared.schoolId, reader, { conversationId: shared.conversationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const continued = await send(shared.schoolId, colleague, { conversationId: shared.conversationId });
    expect(continued.run).toMatchObject({ conversationId: shared.conversationId, userId: colleague });
    expect(continued.item.body.author).toEqual({ userId: colleague, name: 'Asha Rao' });
  });

  it('never opens a private conversation to the paper’s people, whatever it is about', async () => {
    const owner = await seedTurn({ body: { seed: { kind: 'question_paper', ...PAPER } } });
    const colleague = user();
    grant(colleague, READ, MANAGE);
    await expect(get(owner.schoolId, owner.conversationId, colleague)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await history(owner.schoolId, colleague)).items).toEqual([]);
  });

  it('is listed in the paper’s history for whoever may change the paper, and only that paper’s', async () => {
    const shared = await sharedConversation();
    const [reader, colleague] = [user(), user()];
    grant(reader, READ);
    grant(colleague, READ, MANAGE);

    const listed = await history(shared.schoolId, colleague);
    expect(listed.items.map((item) => [item.id, item.attention, item.sharedWithPaper])).toEqual([[shared.conversationId, 'working', true]]);
    // The test users have no account row, so the starter has no name to show.
    expect(listed.items[0]?.startedByName).toBeNull();
    expect((await history(shared.schoolId, colleague, { ...PAPER, modeSlug: 'oral' })).items).toEqual([]);
    await expect(history(shared.schoolId, reader)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets the paper’s people stop a turn, but only its starter delete it', async () => {
    const shared = await sharedConversation();
    const [reader, colleague] = [user(), user()];
    grant(reader, READ);
    grant(colleague, READ, MANAGE);
    const ids = { schoolId: shared.schoolId, conversationId: shared.conversationId };

    await expect(call(assistantRouter.stopRun, { schoolId: shared.schoolId, runId: shared.runId }, as(reader))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(call(assistantRouter.stopRun, { schoolId: shared.schoolId, runId: shared.runId }, as(colleague))).resolves.toMatchObject({ id: shared.runId });

    await setRunStatus({ conversationId: shared.conversationId, runId: shared.runId }, 'cancelled');
    await expect(call(assistantRouter.deleteConversation, ids, as(colleague))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(call(assistantRouter.deleteConversation, ids, as(shared.ownerId))).resolves.toEqual({ id: shared.conversationId });
    // Deleted by its starter, it is gone for the paper's people too.
    await expect(get(shared.schoolId, shared.conversationId, colleague)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
