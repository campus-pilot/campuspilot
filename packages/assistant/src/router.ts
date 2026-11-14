import { issueAssistantRunToken } from '@campuspilot/api/assistant/token';
import { resolvePaperScope } from '@campuspilot/api/routers/school/question-paper/question-paper.scope';
import type { AssistantAttachmentKind, AssistantMessageSeed } from '@campuspilot/assistant-contract/attachments';
import { assistantContract } from '@campuspilot/assistant-contract/contract';
import { ASSISTANT_LIST_PAGE_SIZE, type AssistantStreamEvent } from '@campuspilot/assistant-contract/dto';
import { implement, ORPCError } from '@orpc/server';

import { bindAttachments, deleteConversationAttachments, lockUnsentAttachments, toAttachmentRef, unreadableAttachmentMessage } from './attachments';
import { assertCanSee, assertCanUse, assertMember, canSee, loadAssistantAccess } from './access';
import { db } from './db';
import { handOverApprovalResolution, handOverRun } from './dispatch';
import { liveEvents, streamingTexts, subscribeAssistantEvents } from './events';
import { generateId } from './ids';
import { log } from './log';
import { stopRun } from './run-stop';
import { storeRunToken } from './run-token';
import {
  configuredProviderSettings,
  missingProviderReason,
  selectedProviderId,
} from './runtime/providers/config';
import { readableMimeTypesOf } from './runtime/providers/image-types';
import { resolveAssistantSession, type AssistantSession } from './session';
import * as store from './store';
import { userMessageItemKey } from './transcript';

/**
 * The assistant's browser procedures, served by the API server at
 * `/model/rpc/*` (http.ts). They run in the API process: the session, the
 * access checks and the delegated token are the API's own, in-process. The
 * turn itself runs in `apps/worker`, handed over through the outbox
 * (dispatch.ts), so no request waits for the worker.
 */
export type AssistantRequestContext = { headers: Headers };

/**
 * Refuses a "Continue in chat" seed whose paper key does not resolve in the
 * school (session, exam, class, subject and mode are all checked by the same
 * function the question paper procedures use). Permission is not decided
 * here: the tools the model then calls check it. A seed never reaches the
 * model without this check, and its parts are limited to the slug charset by
 * the contract.
 */
async function assertSeedNamesAPaper(schoolId: string, seed: NonNullable<AssistantMessageSeed>) {
  try {
    await resolvePaperScope(db, { schoolId, sessionId: seed.sessionId, examSlug: seed.examSlug, classId: seed.classId, subjectSlug: seed.subjectSlug, modeSlug: seed.modeSlug });
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) {
      throw new ORPCError('BAD_REQUEST', { message: 'The question paper this chat was started from was not found. Start a new chat from the Question paper screen.' });
    }
    throw error;
  }
}

const os = implement(assistantContract).$context<AssistantRequestContext>();

/**
 * Every procedure is for a signed-in CampusPilot user with a browser
 * session (see `resolveAssistantSession`).
 */
const authed = os.use(async ({ context, next }) => {
  const session = await resolveAssistantSession(context.headers);
  if (!session) throw new ORPCError('UNAUTHORIZED');
  return next({ context: { session } });
});

type Authed = { session: AssistantSession };

/**
 * Throws unless the user may see the assistant in the school (feature,
 * membership, an eligible role the school switched on; not the limit).
 */
async function assertReadAccess(context: Authed, schoolId: string) {
  assertCanSee(await loadAssistantAccess(context.session, schoolId));
}

/** Throws unless the user may start or continue a turn in the school now. */
async function assertUseAccess(context: Authed, schoolId: string) {
  assertCanUse(await loadAssistantAccess(context.session, schoolId));
}

/**
 * Issues the run's delegated token in-process and keeps it for the worker.
 * Called whenever the user is present (sending, approving), so a run that
 * waited a long time for approval resumes with a fresh token. Throws the
 * API's refusal (for example FORBIDDEN) unchanged.
 */
async function refreshRunToken(context: Authed, scope: { schoolId: string; conversationId: string; runId: string }) {
  const { token, expiresAt } = await issueAssistantRunToken(context.session.context, scope);
  await storeRunToken(scope.runId, token, expiresAt);
}

/** The provider new conversations start on, when it is configured. */
function selectedProvider() {
  const id = selectedProviderId();
  return configuredProviderSettings().get(id) ?? null;
}

/**
 * Whether a model is configured for new conversations. Separate from the
 * user's access: a deployment without a provider says so even to users who
 * may use the assistant.
 */
function providerAvailability() {
  const provider = selectedProvider();
  return provider
    ? { configured: true, unavailableReason: null }
    : { configured: false, unavailableReason: missingProviderReason(selectedProviderId()) };
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
async function streamStillAllowed(context: Authed, headers: Headers, schoolId: string): Promise<boolean> {
  try {
    const current = await resolveAssistantSession(headers);
    return current?.user.id === context.session.user.id && canSee(await loadAssistantAccess(current, schoolId));
  } catch (err) {
    log.warn({ err, schoolId }, 'assistant.stream.access-recheck-failed');
    return true;
  }
}

/** Longest conversation title derived from the first message. */
const TITLE_MAX_LENGTH = 80;

/** A title for a message without words, named after what it carries. */
function attachmentsTitle(kinds: readonly AssistantAttachmentKind[]): string {
  const documents = kinds.filter((kind) => kind === 'document').length;
  if (documents === 0) return kinds.length === 1 ? 'Attached image' : 'Attached images';
  if (documents === kinds.length) return documents === 1 ? 'Attached PDF' : 'Attached PDFs';
  return 'Attached files';
}

function titleFromMessage(text: string, attachmentKinds: readonly AssistantAttachmentKind[] = []): string {
  if (!text.trim()) return attachmentsTitle(attachmentKinds);
  const firstLine = text.split('\n').find((line) => line.trim())?.trim() ?? text.trim();
  return firstLine.length > TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : firstLine;
}

async function ownedConversation(context: Authed, schoolId: string, conversationId: string) {
  const owned = await store.findOwnedConversation(db, {
    conversationId,
    schoolId,
    userId: context.session.user.id,
  });
  if (!owned) throw new ORPCError('NOT_FOUND', { message: 'Assistant conversation was not found.' });
  return owned;
}

export const assistantRouter = os.router({
  /**
   * The user's assistant state in the school: whether their role may use it
   * (`allowed`, which the app's entry points follow) and whether they can
   * send now (`available`, with the reason when not: no model, their role,
   * the school's limit).
   */
  getStatus: authed.getStatus.handler(async ({ context, input }) => {
    const access = await loadAssistantAccess(context.session, input.schoolId);
    // The status answers every member, so the app can tell "not for you"
    // (`allowed: false`) from an error; everything else requires `allowed`.
    assertMember(access);
    const provider = providerAvailability();
    const allowed = canSee(access);
    if (!provider.configured) return { configured: false, allowed, available: false, unavailableReason: provider.unavailableReason };
    return {
      configured: true,
      allowed,
      available: access.allowed,
      unavailableReason: access.refusal?.message ?? null,
    };
  }),

  listConversations: authed.listConversations.handler(async ({ context, input }) => {
    await assertReadAccess(context, input.schoolId);
    const pageSize = ASSISTANT_LIST_PAGE_SIZE;
    const { items, totalItems } = await store.listConversations(db, {
      schoolId: input.schoolId,
      userId: context.session.user.id,
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
    await assertReadAccess(context, input.schoolId);
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
    const contextHeaders = context.headers;
    await assertReadAccess(context, input.schoolId);
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
      for await (const event of liveEvents(subscription, HEARTBEAT_MS)) {
        if (Date.now() - accessCheckedAt >= ACCESS_RECHECK_MS) {
          accessCheckedAt = Date.now();
          // Ending the stream makes the browser reconnect, and that request
          // gets the real refusal (signed out, or no longer permitted).
          if (!(await streamStillAllowed(context, contextHeaders, input.schoolId))) return;
        }
        yield event === 'heartbeat' ? ({ type: 'heartbeat' } satisfies AssistantStreamEvent) : event;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await subscription.close();
    }
  }),

  sendMessage: authed.sendMessage.handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    // Even a replay returns the conversation, so it needs the user to see the
    // assistant first; sending anew then needs full use access below.
    await assertReadAccess(context, input.schoolId);

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
      return {
        conversation: store.toConversationDto(conversation),
        run: store.toRunDto(replay),
        item: itemDto,
      };
    }

    await assertUseAccess(context, input.schoolId);
    // The seed is written into the model's context: it must name a paper that exists in this school (not free text).
    if (input.seed) await assertSeedNamesAPaper(input.schoolId, input.seed);
    const status = providerAvailability();
    if (!status.configured) {
      throw new ORPCError('PRECONDITION_FAILED', {
        message: status.unavailableReason ?? 'The assistant is unavailable.',
      });
    }
    // A conversation stays on the provider it started with; new ones use the
    // currently selected provider.
    const provider = input.conversationId
      ? configuredProviderSettings().get((await ownedConversation(context, input.schoolId, input.conversationId)).provider) ?? null
      : selectedProvider();
    if (!provider) {
      throw new ORPCError('PRECONDITION_FAILED', {
        message: 'This conversation runs on a model provider that is not configured now. Start a new conversation.',
      });
    }

    const conversationId = input.conversationId ?? generateId('conversation');
    const runId = generateId('run');
    // The token is requested before anything is saved: if the API refuses,
    // nothing is left behind.
    await refreshRunToken(context, { schoolId: input.schoolId, conversationId, runId });

    const created = await store.assistantTransaction(db, async (tx, emit) => {
      // Continuing a conversation: locked and checked again here, so a delete
      // that committed since the check above cannot be followed by a new run.
      if (input.conversationId && !(await store.lockLiveConversation(tx, conversationId))) {
        throw new ORPCError('NOT_FOUND', { message: 'Assistant conversation was not found.' });
      }
      // Attachments are bound in this transaction: the message either carries every
      // one of them or is not saved (decision D46 is checked here, before any cost).
      const attachments = await lockUnsentAttachments(tx, { schoolId: input.schoolId, userId, ids: input.attachmentIds });
      const unreadable = unreadableAttachmentMessage(attachments, readableMimeTypesOf(provider.id));
      if (unreadable) throw new ORPCError('BAD_REQUEST', { message: unreadable });
      if (!input.conversationId) {
        await store.createConversation(tx, {
          id: conversationId,
          schoolId: input.schoolId,
          userId,
          title: titleFromMessage(input.text, attachments.map((row) => row.kind)),
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
          ...(attachments.length > 0 ? { attachments: attachments.map(toAttachmentRef) } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        itemKey: userMessageItemKey(runId),
      });
      await bindAttachments(tx, { rows: attachments, conversationId, itemId: item.id });
      const conversation = await store.findConversation(tx, conversationId);
      if (item.kind !== 'user_message' || !conversation) throw new ORPCError('INTERNAL_SERVER_ERROR');
      return { conversation: store.toConversationDto(conversation), run, item };
    });

    // After commit: the run is saved, so a failed hand-over is only delayed
    // (the outbox sweep sends it), never lost.
    await handOverRun(runId);
    return created;
  }),

  /**
   * Approving continues the turn, so it needs use access (enforced by the
   * fresh token it issues); declining needs read access, so it stays
   * possible at the limit.
   */
  respondToApproval: authed.respondToApproval.handler(async ({ context, input }) => {
    await assertReadAccess(context, input.schoolId);
    const approval = await store.findApproval(db, input.approvalId);
    if (!approval || approval.schoolId !== input.schoolId || approval.userId !== context.session.user.id) {
      throw new ORPCError('NOT_FOUND', { message: 'Assistant approval was not found.' });
    }
    // An approval of a deleted conversation is gone with it.
    await ownedConversation(context, input.schoolId, approval.conversationId);
    if (approval.status !== 'pending') {
      throw new ORPCError('CONFLICT', { message: 'This action was already decided.' });
    }
    // Once a stop is asked the change must not be approved, even in the
    // moment before the stop cancels this approval.
    const stoppedRun = await store.findRun(db, approval.runId);
    if (input.decision === 'approve' && stoppedRun?.stopRequestedAt) {
      throw new ORPCError('CONFLICT', { message: 'The assistant was stopped, so this change will not be made.' });
    }
    if (input.decision === 'approve') {
      // The user is present now, so the run resumes with a fresh token even
      // after a long wait.
      await refreshRunToken(context, {
        schoolId: approval.schoolId,
        conversationId: approval.conversationId,
        runId: approval.runId,
      });
    }
    // Decided under the run's lock, so a stop that lands while the token was
    // issued wins: the change is then never approved.
    const outcome = await store.decideApprovalUnlessStopped(db, {
      approvalId: approval.id,
      runId: approval.runId,
      status: input.decision === 'approve' ? 'approved' : 'declined',
    });
    if (outcome.stopped) {
      throw new ORPCError('CONFLICT', { message: 'The assistant was stopped, so this change will not be made.' });
    }
    const decided = outcome.decided;
    if (!decided) throw new ORPCError('CONFLICT', { message: 'This action was already decided.' });
    // The decision is saved, which is what the run wakes with; a hand-over
    // that fails now is sent by the outbox sweep.
    await handOverApprovalResolution(decided.id);
    const run = await store.findRun(db, approval.runId);
    if (!run) throw new ORPCError('NOT_FOUND');
    return store.toRunDto(run);
  }),

  /** Stopping spends nothing, so it needs only read access (it stays possible at the limit). */
  stopRun: authed.stopRun.handler(async ({ context, input }) => {
    await assertReadAccess(context, input.schoolId);
    const run = await store.findRun(db, input.runId);
    if (!run || run.schoolId !== input.schoolId || run.userId !== context.session.user.id) {
      throw new ORPCError('NOT_FOUND', { message: 'Assistant run was not found.' });
    }
    await ownedConversation(context, input.schoolId, run.conversationId);
    try {
      return await stopRun(run, (approvalId) => handOverApprovalResolution(approvalId));
    } catch (error) {
      log.error({ err: error, runId: run.id }, 'assistant.run.stop.failed');
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'The assistant could not be stopped. Please try again.' });
    }
  }),

  /**
   * Deletes a conversation for good. The same checks as reading it: the
   * user may see the assistant in the school (feature, membership, an
   * eligible role switched on; not the limit), and the conversation is their
   * own. It is refused while a run has not finished, so the user stops the
   * assistant first and nothing is deleted from under a working turn. The
   * delete is soft (`deleted_at`): every row stays and the costs of its
   * model requests stay linked to their run, so spend and limits do not
   * change; for the user it is gone from every procedure.
   */
  deleteConversation: authed.deleteConversation.handler(async ({ context, input }) => {
    await assertReadAccess(context, input.schoolId);
    const owned = await ownedConversation(context, input.schoolId, input.conversationId);
    const outcome = await store.deleteConversation(db, owned.id, context.session.user.id);
    if (outcome === 'busy') {
      throw new ORPCError('CONFLICT', { message: 'Stop the assistant before deleting this conversation.' });
    }
    // Deleted by another request in between: it is gone either way.
    if (outcome === 'missing') throw new ORPCError('NOT_FOUND', { message: 'Assistant conversation was not found.' });
    // The files the user attached go with the chat they deleted; nothing reads them any more.
    await deleteConversationAttachments(db, owned.id).catch((err) =>
      log.warn({ err, conversationId: owned.id }, 'assistant.conversation.attachments.cleanup.failed'),
    );
    log.info({ conversationId: owned.id, schoolId: input.schoolId }, 'assistant.conversation.deleted');
    return { id: owned.id };
  }),
});

export type AssistantRouter = typeof assistantRouter;
