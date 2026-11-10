import { assistantContract } from '@campuspilot/assistant-contract/contract';
import {
  ASSISTANT_LIST_PAGE_SIZE,
  ASSISTANT_TERMINAL_RUN_STATUSES,
  type AssistantStreamEvent,
} from '@campuspilot/assistant-contract/dto';
import { implement, ORPCError } from '@orpc/server';

import { db } from './db/client';
import { entitlements } from './entitlements';
import { signalAssistantRunStop, streamingTexts, subscribeAssistantEvents } from './events';
import { generateId } from './ids';
import { log } from './log';
import {
  canUseAssistant,
  getSessionUser,
  refreshRunToken,
  type SessionUser,
} from './platform';
import { restateDispatcher, type RunDispatcher } from './runtime/contract';
import { providerRegistry } from './runtime/providers/registry';
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
  const providers = providerRegistry();
  if (!providers.current) {
    return {
      configured: false,
      available: false,
      unavailableReason: providers.unavailableReason ?? 'The assistant is not configured for this deployment.',
    };
  }
  const decision = await entitlements().checkRunAllowed({ schoolId, userId });
  return decision.allowed
    ? { configured: true, available: true, unavailableReason: null }
    : { configured: true, available: false, unavailableReason: decision.reason };
}

/** Idle interval after which the stream sends a heartbeat. */
const HEARTBEAT_MS = 15_000;

/** How often an open stream confirms its user may still read it. */
const ACCESS_RECHECK_MS = 2 * 60_000;

/**
 * Whether the user of an open stream is still signed in and still allowed
 * to use the assistant in the school. A stream stays open for hours, so the
 * check made when it opened says nothing about now. When the API cannot be
 * asked, the stream is kept: an outage must not close every conversation,
 * and the next check decides.
 */
async function streamStillAllowed(context: Authed, schoolId: string): Promise<boolean> {
  try {
    const user = await getSessionUser(context.cookie);
    return user?.id === context.user.id && (await canUseAssistant(context.cookie, user.id, schoolId));
  } catch (err) {
    log.warn({ err, schoolId }, 'assistant.stream.access-recheck-failed');
    return true;
  }
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
    const { items, totalItems } = await store.listConversations(db, {
      schoolId: input.schoolId,
      userId: context.user.id,
      page: input.page,
      pageSize,
    });
    const totalPages = Math.ceil(totalItems / pageSize);
    return {
      items,
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
   * The subscription opens before state is read, so nothing committed in
   * between can be missed; clients drop upserts not newer than their state.
   * A client that already holds data passes `afterSequence` and gets only
   * what changed (a `resume`), falling back to a snapshot when that is large.
   * Text already streamed for unfinished messages follows, then a
   * `synchronized` marker; while idle, a heartbeat every 15s lets the client
   * tell a quiet stream from a dead connection.
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
      const resumed =
        input.afterSequence === undefined ? null : await store.loadChangesSince(db, owned.id, input.afterSequence);
      const state = resumed ?? (await store.loadSnapshot(db, owned.id));
      if (!state) throw new ORPCError('NOT_FOUND');
      yield { type: resumed ? 'resume' : 'snapshot', ...state } satisfies AssistantStreamEvent;

      const streaming = (resumed ? (await store.loadSnapshot(db, owned.id))?.items ?? [] : state.items).filter(
        (item) => item.kind === 'assistant_message' && item.status === 'streaming',
      );
      for (const [itemId, text] of await streamingTexts(streaming.map((item) => item.id))) {
        yield { type: 'text', itemId, offset: 0, delta: text } satisfies AssistantStreamEvent;
      }
      yield { type: 'synchronized' } satisfies AssistantStreamEvent;

      let accessCheckedAt = Date.now();
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const event = await Promise.race([
          subscription.next(),
          new Promise<'heartbeat'>((resolve) => {
            timer = setTimeout(() => resolve('heartbeat'), HEARTBEAT_MS);
          }),
        ]);
        clearTimeout(timer);
        if (Date.now() - accessCheckedAt >= ACCESS_RECHECK_MS) {
          accessCheckedAt = Date.now();
          // Ending the stream makes the browser reconnect, and that request
          // gets the real refusal (signed out, or no longer permitted).
          if (!(await streamStillAllowed(context, input.schoolId))) return;
        }
        if (event === 'heartbeat') {
          yield { type: 'heartbeat' } satisfies AssistantStreamEvent;
          continue;
        }
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
      const [conversation, item, attention] = await Promise.all([
        store.findOwnedConversation(db, {
          conversationId: replay.conversationId,
          schoolId: input.schoolId,
          userId,
        }),
        store.findItemByKey(db, replay.conversationId, userMessageItemKey(replay.id)),
        store.conversationAttention(db, replay.conversationId),
      ]);
      const itemDto = item ? store.toItemDto(item) : null;
      if (!conversation || !itemDto || itemDto.kind !== 'user_message') {
        throw new ORPCError('NOT_FOUND', { message: 'Assistant conversation was not found.' });
      }
      return {
        conversation: store.toConversationDto(conversation, attention),
        run: store.toRunDto(replay),
        item: itemDto,
      };
    }

    await assertAssistantAccess(context, input.schoolId);
    const status = await availability(input.schoolId, userId);
    if (!status.available) {
      throw new ORPCError('PRECONDITION_FAILED', {
        message: status.unavailableReason ?? 'The assistant is unavailable.',
      });
    }
    // A conversation stays on the provider it started with; new ones use the
    // currently selected provider.
    const provider = input.conversationId
      ? providerRegistry().get((await ownedConversation(context, input.schoolId, input.conversationId)).provider)
      : providerRegistry().current;
    if (!provider) {
      throw new ORPCError('PRECONDITION_FAILED', {
        message: 'This conversation runs on a model provider that is not configured now. Start a new conversation.',
      });
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
          provider: provider.id,
          model: provider.model,
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
      const conversation = await store.findConversationDto(tx, conversationId);
      if (item.kind !== 'user_message' || !conversation) throw new ORPCError('INTERNAL_SERVER_ERROR');
      return { conversation, run, item };
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

  /**
   * Deletes a conversation for good. The same checks as reading it: the
   * user may use the assistant in the school, and the conversation is their
   * own. It is refused while a run has not finished, so the user stops the
   * assistant first and nothing is deleted from under a working turn.
   */
  deleteConversation: authed.deleteConversation.handler(async ({ context, input }) => {
    await assertAssistantAccess(context, input.schoolId);
    const owned = await ownedConversation(context, input.schoolId, input.conversationId);
    const outcome = await store.deleteConversation(db, owned.id);
    if (outcome === 'busy') {
      throw new ORPCError('CONFLICT', { message: 'Stop the assistant before deleting this conversation.' });
    }
    // Deleted by another request in between: it is gone either way.
    if (outcome === 'missing') throw new ORPCError('NOT_FOUND', { message: 'Assistant conversation was not found.' });
    log.info({ conversationId: owned.id, schoolId: input.schoolId }, 'assistant.conversation.deleted');
    return { id: owned.id };
  }),
});

export type AssistantRouter = typeof assistantRouter;
