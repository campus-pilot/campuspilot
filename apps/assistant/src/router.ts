import { assistantContract } from '@campuspilot/assistant-contract/contract';
import {
  ASSISTANT_LIST_PAGE_SIZE,
  ASSISTANT_TERMINAL_RUN_STATUSES,
  type AssistantStreamEvent,
} from '@campuspilot/assistant-contract/dto';
import { env } from '@campuspilot/env/assistant';
import { implement, ORPCError } from '@orpc/server';
import { and, count, desc, eq } from 'drizzle-orm';

import { db } from './db/client';
import { assistantConversationTable } from './db/schema';
import { entitlements } from './entitlements';
import { signalAssistantRunStop, subscribeAssistantEvents } from './events';
import { generateId } from './ids';
import { log } from './log';
import {
  canUseAssistant,
  getSessionUser,
  refreshRunToken,
  type SessionUser,
} from './platform';
import { restateDispatcher, type RunDispatcher } from './runtime/contract';
import * as store from './store';
import { userMessageItemKey } from './transcript';

export type AssistantRequestContext = { headers: Headers };

let dispatcher: RunDispatcher = restateDispatcher;

/** Replaces the Restate dispatcher (tests). */
export function configureDispatcher(next: RunDispatcher | null) {
  dispatcher = next ?? restateDispatcher;
}

const os = implement(assistantContract).$context<AssistantRequestContext>();

/**
 * Every procedure is for a signed-in CampusPilot user: the session cookie the
 * browser sends is checked by the API, which owns authentication.
 */
const authed = os.use(async ({ context, next }) => {
  const cookie = context.headers.get('cookie') ?? undefined;
  const user = await getSessionUser(cookie);
  if (!cookie || !user) throw new ORPCError('UNAUTHORIZED');
  return next({ context: { cookie, user } });
});

type Authed = { cookie: string; user: SessionUser };

async function assertAssistantAccess(context: Authed, schoolId: string) {
  if (!(await canUseAssistant(context.cookie, context.user.id, schoolId))) {
    throw new ORPCError('FORBIDDEN', {
      message: 'You do not have permission to use the assistant in this school.',
    });
  }
}

/** API refusals (for example a removed role) keep their code for the client. */
function rethrowPlatformError(error: unknown): never {
  if (error instanceof ORPCError) {
    throw new ORPCError(error.code, { message: error.message, status: error.status });
  }
  throw error;
}

async function availability(schoolId: string, userId: string) {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      configured: false,
      available: false,
      unavailableReason: 'The assistant is not configured for this deployment.',
    };
  }
  const decision = await entitlements().checkRunAllowed({ schoolId, userId });
  return decision.allowed
    ? { configured: true, available: true, unavailableReason: null }
    : { configured: true, available: false, unavailableReason: decision.reason };
}

/** Longest conversation title derived from the first message. */
const TITLE_MAX_LENGTH = 80;

function titleFromMessage(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim())?.trim() ?? text.trim();
  return firstLine.length > TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : firstLine;
}

async function ownedConversation(context: Authed, schoolId: string, conversationId: string) {
  const owned = await store.findOwnedConversation(db, {
    conversationId,
    schoolId,
    userId: context.user.id,
  });
  if (!owned) throw new ORPCError('NOT_FOUND', { message: 'Assistant conversation was not found.' });
  return owned;
}

export const assistantRouter = os.router({
  getStatus: authed.getStatus.handler(async ({ context, input }) => {
    await assertAssistantAccess(context, input.schoolId);
    return availability(input.schoolId, context.user.id);
  }),

  listConversations: authed.listConversations.handler(async ({ context, input }) => {
    await assertAssistantAccess(context, input.schoolId);
    const pageSize = ASSISTANT_LIST_PAGE_SIZE;
    const where = and(
      eq(assistantConversationTable.schoolId, input.schoolId),
      eq(assistantConversationTable.userId, context.user.id),
    );
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(assistantConversationTable)
        .where(where)
        .orderBy(desc(assistantConversationTable.updatedAt), desc(assistantConversationTable.id))
        .limit(pageSize)
        .offset((input.page - 1) * pageSize),
      db.select({ value: count() }).from(assistantConversationTable).where(where),
    ]);
    const totalItems = total?.value ?? 0;
    const totalPages = Math.ceil(totalItems / pageSize);
    return {
      items: rows.map(store.toConversationDto),
      pagination: {
        nextCursor: input.page < totalPages ? String(input.page + 1) : null,
        currentPage: input.page,
        totalPages,
        totalItems,
        pageSize,
      },
    };
  }),

  getConversation: authed.getConversation.handler(async ({ context, input }) => {
    await assertAssistantAccess(context, input.schoolId);
    const owned = await ownedConversation(context, input.schoolId, input.conversationId);
    const snapshot = await store.loadSnapshot(db, owned.id);
    if (!snapshot) throw new ORPCError('NOT_FOUND');
    return snapshot;
  }),

  /**
   * The subscription opens before the snapshot is read, so nothing committed
   * in between can be missed; clients drop upserts not newer than their state.
   */
  subscribeConversation: authed.subscribeConversation.handler(async function* ({
    context,
    input,
    signal,
  }) {
    await assertAssistantAccess(context, input.schoolId);
    const owned = await ownedConversation(context, input.schoolId, input.conversationId);

    const subscription = await subscribeAssistantEvents(owned.id);
    const onAbort = () => void subscription.close();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const snapshot = await store.loadSnapshot(db, owned.id);
      if (!snapshot) throw new ORPCError('NOT_FOUND');
      yield { type: 'snapshot', ...snapshot } satisfies AssistantStreamEvent;
      while (true) {
        const event = await subscription.next();
        if (!event) return;
        yield event;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await subscription.close();
    }
  }),

  sendMessage: authed.sendMessage.handler(async ({ context, input }) => {
    const userId = context.user.id;

    const replay = await store.findRunByClientRequest(db, {
      userId,
      clientRequestId: input.clientRequestId,
    });
    if (replay) {
      if (replay.schoolId !== input.schoolId) {
        throw new ORPCError('CONFLICT', { message: 'This request id was already used in another school.' });
      }
      const [conversation, item] = await Promise.all([
        store.findOwnedConversation(db, {
          conversationId: replay.conversationId,
          schoolId: input.schoolId,
          userId,
        }),
        store.findItemByKey(db, replay.conversationId, userMessageItemKey(replay.id)),
      ]);
      const itemDto = item ? store.toItemDto(item) : null;
      if (!conversation || !itemDto || itemDto.kind !== 'user_message') {
        throw new ORPCError('NOT_FOUND', { message: 'Assistant conversation was not found.' });
      }
      return { conversation: store.toConversationDto(conversation), run: store.toRunDto(replay), item: itemDto };
    }

    await assertAssistantAccess(context, input.schoolId);
    const status = await availability(input.schoolId, userId);
    if (!status.available) {
      throw new ORPCError('PRECONDITION_FAILED', {
        message: status.unavailableReason ?? 'The assistant is unavailable.',
      });
    }
    if (input.conversationId) {
      await ownedConversation(context, input.schoolId, input.conversationId);
    }

    const conversationId = input.conversationId ?? generateId('conversation');
    const runId = generateId('run');
    // The token is requested before anything is saved: if the API refuses,
    // nothing is left behind.
    try {
      await refreshRunToken(context.cookie, { schoolId: input.schoolId, conversationId, runId });
    } catch (error) {
      rethrowPlatformError(error);
    }

    const created = await store.assistantTransaction(db, async (tx, emit) => {
      if (!input.conversationId) {
        await store.createConversation(tx, {
          id: conversationId,
          schoolId: input.schoolId,
          userId,
          title: titleFromMessage(input.text),
        });
      }
      const run = await store.insertRun(tx, emit, {
        id: runId,
        conversationId,
        schoolId: input.schoolId,
        userId,
        clientRequestId: input.clientRequestId,
        surface: input.surface,
      });
      const item = await store.insertItem(tx, emit, {
        conversationId,
        runId,
        kind: 'user_message',
        status: 'complete',
        body: {
          text: input.text,
          ...(input.pageContext ? { pageContext: input.pageContext } : {}),
        },
        itemKey: userMessageItemKey(runId),
      });
      const conversation = await store.findConversation(tx, conversationId);
      if (item.kind !== 'user_message' || !conversation) throw new ORPCError('INTERNAL_SERVER_ERROR');
      return { conversation: store.toConversationDto(conversation), run, item };
    });

    try {
      await dispatcher.startRun({
        conversationId,
        runId,
        user: { name: context.user.name, email: context.user.email },
      });
    } catch (err) {
      log.error({ err, runId, conversationId }, 'assistant.dispatch.failed');
      // The message is saved; the run is marked failed so the user can see
      // it did not start and send again.
      const run = await store.assistantTransaction(db, (tx, emit) =>
        store.updateRun(tx, emit, created.run, {
          status: 'failed',
          errorCode: 'dispatch_failed',
          errorMessage: 'The assistant could not start. Please try again.',
          completedAt: new Date(),
        }),
      );
      return { ...created, run };
    }
    return created;
  }),

  respondToApproval: authed.respondToApproval.handler(async ({ context, input }) => {
    const approval = await store.findApproval(db, input.approvalId);
    if (!approval || approval.schoolId !== input.schoolId || approval.userId !== context.user.id) {
      throw new ORPCError('NOT_FOUND', { message: 'Assistant approval was not found.' });
    }
    if (approval.status !== 'pending') {
      throw new ORPCError('CONFLICT', { message: 'This action was already decided.' });
    }
    if (input.decision === 'approve') {
      // The user is present now, so the run resumes with a fresh token even
      // after a long wait.
      try {
        await refreshRunToken(context.cookie, {
          schoolId: approval.schoolId,
          conversationId: approval.conversationId,
          runId: approval.runId,
        });
      } catch (error) {
        rethrowPlatformError(error);
      }
    }
    const decided = await store.decideApproval(
      db,
      approval.id,
      input.decision === 'approve' ? 'approved' : 'declined',
    );
    if (!decided) throw new ORPCError('CONFLICT', { message: 'This action was already decided.' });

    try {
      await dispatcher.resolveApproval({
        awakeableId: decided.awakeableId,
        resolution: { decision: input.decision },
      });
    } catch (error) {
      await store.reopenApproval(db, approval.id);
      log.error({ err: error, approvalId: approval.id }, 'assistant.approval.resume.failed');
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'The assistant could not resume. Please try again.' });
    }
    const run = await store.findRun(db, approval.runId);
    if (!run) throw new ORPCError('NOT_FOUND');
    return store.toRunDto(run);
  }),

  stopRun: authed.stopRun.handler(async ({ context, input }) => {
    const run = await store.findRun(db, input.runId);
    if (!run || run.schoolId !== input.schoolId || run.userId !== context.user.id) {
      throw new ORPCError('NOT_FOUND', { message: 'Assistant run was not found.' });
    }
    if (ASSISTANT_TERMINAL_RUN_STATUSES.has(run.status) || run.stopRequestedAt) {
      return store.toRunDto(run);
    }
    const stopped = await store.assistantTransaction(db, (tx, emit) =>
      store.updateRun(tx, emit, run, { stopRequestedAt: new Date() }),
    );
    await signalAssistantRunStop(run.id);

    const pending = await store.findPendingApprovalForRun(db, run.id);
    if (pending && (await store.decideApproval(db, pending.id, 'cancelled'))) {
      await dispatcher.resolveApproval({
        awakeableId: pending.awakeableId,
        resolution: { decision: 'cancel' },
      });
    }
    return stopped;
  }),
});

export type AssistantRouter = typeof assistantRouter;
