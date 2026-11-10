import { randomUUID } from 'node:crypto';

import { assistantConversationAttention, type AssistantRunStatus } from '@campuspilot/assistant-contract/dto';
import { call, ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { db } from './db/client';
import {
  assistantApprovalTable,
  assistantConversationTable,
  assistantItemTable,
  assistantRunTable,
  assistantTranscriptEntryTable,
} from './db/schema';
import { generateId } from './ids';
import { canUseAssistant, getSessionUser } from './platform';
import { assistantRouter, configureDispatcher } from './router';
import * as store from './store';
import { seedTurn, type SeededTurn } from './testing/turn';
import { userMessageItemKey } from './transcript';

/**
 * The history list and deleting a conversation, through the service's own
 * router against the real store and Postgres. Only the CampusPilot API is
 * replaced: who the session cookie belongs to (`getSessionUser`) and whether
 * that user may use the assistant in the school (`canUseAssistant`).
 */
vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform')>()),
  getSessionUser: vi.fn(),
  canUseAssistant: vi.fn(),
}));

const getSessionUserMock = vi.mocked(getSessionUser);
const canUseAssistantMock = vi.mocked(canUseAssistant);

/** The session cookie of a user, as the fake API reads it back. */
const cookieOf = (userId: string) => `session=${userId}`;

beforeEach(() => {
  getSessionUserMock.mockReset().mockImplementation(async (cookie) => {
    const userId = cookie?.replace('session=', '');
    return userId ? { id: userId, name: 'Asha Rao', email: 'asha.rao@school.test' } : null;
  });
  canUseAssistantMock.mockReset().mockResolvedValue(true);
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

  it('can be pressed again after waking the run failed, and the change cannot be approved meanwhile', async () => {
    const { turn, approval } = await waitingForApproval();
    const resolveApproval = vi.fn().mockRejectedValueOnce(new Error('Restate is unreachable')).mockResolvedValue(undefined);
    configureDispatcher({ startRun: vi.fn(), resolveApproval });
    onTestFinished(() => configureDispatcher(null));
    const stop = () => call(assistantRouter.stopRun, { schoolId: turn.schoolId, runId: turn.runId }, as(turn.userId));

    await expect(stop()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect((await store.findApproval(db, approval.id))?.status).toBe('pending');
    await expect(
      call(assistantRouter.respondToApproval, { schoolId: turn.schoolId, approvalId: approval.id, decision: 'approve' }, as(turn.userId)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(stop()).resolves.toMatchObject({ id: turn.runId });
    expect(resolveApproval).toHaveBeenCalledTimes(2);
    expect(resolveApproval).toHaveBeenLastCalledWith({ awakeableId: 'awk_waiting', resolution: { decision: 'cancel' } });
    expect((await store.findApproval(db, approval.id))?.status).toBe('cancelled');
  });
});

describe('deleting a conversation', () => {
  it('removes the conversation and everything in it, and nothing else', async () => {
    const turn = await finishedConversationWithEverything();
    const other = await addConversation(turn, 'Keep me');
    await setRunStatus(other, 'completed');
    expect(await rowsOf(turn.conversationId)).toEqual({ conversations: 1, runs: 1, items: 2, approvals: 1, transcript: 1 });

    await expect(remove(turn, turn.userId)).resolves.toEqual({ id: turn.conversationId });

    expect(await rowsOf(turn.conversationId)).toEqual({ conversations: 0, runs: 0, items: 0, approvals: 0, transcript: 0 });
    expect(await rowsOf(other.conversationId)).toMatchObject({ conversations: 1, runs: 1, items: 1 });
    expect((await list(turn)).items.map((item) => item.id)).toEqual([other.conversationId]);
    await expect(
      call(assistantRouter.getConversation, { schoolId: turn.schoolId, conversationId: turn.conversationId }, as(turn.userId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 0, runs: 0, items: 0 });
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

  it('is refused for a user who may not use the assistant in the school', async () => {
    const turn = await finishedConversationWithEverything();
    canUseAssistantMock.mockResolvedValue(false);
    await expect(remove(turn, turn.userId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(canUseAssistantMock).toHaveBeenCalledWith(cookieOf(turn.userId), turn.userId, turn.schoolId);
    expect(await rowsOf(turn.conversationId)).toMatchObject({ conversations: 1 });
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
