'use client';

import {
  assistantConversationAttention,
  type AssistantConversationListItemDto,
  type AssistantItemDto,
  type AssistantRunDto,
  type AssistantStreamEvent,
  type AssistantSurface,
} from '@campuspilot/assistant-contract/dto';
import {
  activeRun,
  assistantAnnouncement,
  buildAssistantTimeline,
  lastUserText,
  sumAssistantUsage,
  pendingApprovals,
  queuedMessages,
  type AssistantApprovalDecision,
} from '@campuspilot/components/assistant';
import {
  experimental_streamedQuery as streamedQuery,
  hashKey,
  onlineManager,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type Mutation,
  type QueryClient,
} from '@tanstack/react-query';
import { useRef, useState, useSyncExternalStore } from 'react';

import { assistantClient, assistantOrpc } from '@/lib/assistant-client';
import { authClient } from '@/lib/auth-client';
import { orpc } from '@/lib/orpc';

import {
  applyAssistantEvent,
  EMPTY_CONVERSATION_STATE,
  eventChangedConversationList,
  eventChangedSchoolData,
  withConnectionLost,
  type AssistantConversationState,
} from './assistant-conversation-state';
import { draftKey, readDraft, sessionDraftStorage, writeDraft } from './assistant-draft';
import { conversationFailure, isClientError, reconnectingStream, refusalMessage, retryUnlessRefused } from './assistant-stream';

/**
 * Longest silence accepted from a live stream. The server sends a heartbeat
 * every 15s while idle, so this much silence means a dead connection (for
 * example a half-open socket after a network switch), not a quiet chat.
 */
const STREAM_SILENCE_MS = 40_000;

/**
 * Per QueryClient: when each live conversation last heard from the server,
 * by query hash. Having an entry also means the client's wake listeners are
 * installed.
 */
const lastHeardByClient = new WeakMap<QueryClient, Map<string, number>>();

/**
 * On returning to the tab or regaining the network, conversations that have
 * not heard from the server recently reconnect at once instead of waiting
 * out a backoff. Resuming is cheap: it sends only what changed.
 *
 * Installed once per QueryClient (not once per page: a second client would
 * otherwise never be woken). Returns that client's last-heard times, which
 * forget a conversation when its query leaves the cache.
 */
function installWakeListeners(queryClient: QueryClient): Map<string, number> {
  const installed = lastHeardByClient.get(queryClient);
  if (installed) return installed;
  const lastHeard = new Map<string, number>();
  lastHeardByClient.set(queryClient, lastHeard);
  if (typeof window === 'undefined') return lastHeard;
  const wake = () => {
    if (document.visibilityState !== 'visible') return;
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ['assistant', 'conversation'], type: 'active' })) {
      if (Date.now() - (lastHeard.get(query.queryHash) ?? 0) > 20_000) {
        void queryClient.refetchQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') lastHeard.delete(event.query.queryHash);
  });
  return lastHeard;
}

/**
 * One connection's lifetime: its signal aborts when the query is cancelled
 * or when the server goes silent (counted from before connecting, so a
 * connection that never opens is also given up on).
 */
function watchConnection(signal: AbortSignal) {
  const connection = new AbortController();
  const abort = () => connection.abort();
  let silence = setTimeout(abort, STREAM_SILENCE_MS);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return {
    signal: connection.signal,
    heard() {
      clearTimeout(silence);
      silence = setTimeout(abort, STREAM_SILENCE_MS);
    },
    end() {
      clearTimeout(silence);
      signal.removeEventListener('abort', abort);
    },
    /**
     * An error from a connection this watch ended is a dropped connection,
     * whatever the transport reports for the abort, so it is never final.
     */
    failure(error: unknown): unknown {
      return connection.signal.aborted ? new Error('The assistant stream was dropped.', { cause: error }) : error;
    },
  };
}

/**
 * Passes one connection's events through, watches for silence, and keeps
 * the rest of the app in step: CampusPilot data refreshes when a change the
 * assistant made went through (live, or while this tab was disconnected),
 * and the history list when a conversation changes or a run ends.
 */
async function* watchedEvents(
  events: AsyncIterable<AssistantStreamEvent>,
  watch: ReturnType<typeof watchConnection>,
  queryClient: QueryClient,
  /** The sequence held before this connection; null on a first load. */
  cursor: number | null,
  heard: () => void,
): AsyncGenerator<AssistantStreamEvent> {
  try {
    for await (const event of events) {
      watch.heard();
      heard();
      if (eventChangedSchoolData(event, cursor)) {
        void queryClient.invalidateQueries({ queryKey: orpc.school.key() });
      }
      if (eventChangedConversationList(event)) {
        void queryClient.invalidateQueries({ queryKey: assistantOrpc!.listConversations.key() });
      }
      yield event;
    }
  } catch (error) {
    throw watch.failure(error);
  } finally {
    watch.end();
  }
}

/**
 * The wait before a reconnect: equal-jitter backoff while online. While the
 * browser is offline there is nothing to try, so it waits for the network
 * instead and then reconnects at once. Settles early when aborted.
 */
function reconnectDelay(attempt: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = onlineManager.isOnline() ? setTimeout(done, equalJitterDelay(attempt)) : undefined;
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online) done();
    });
    if (signal.aborted) done();
    else signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

type ConversationKey = readonly ['assistant', 'conversation', string, string];

/**
 * A conversation's events for as long as it is watched. Reconnection lives
 * here, inside the stream, not in the query's retry: a streamed query stays
 * "fetching" and counts no successes, so query-level retries never learn
 * that a reconnect worked (the backoff only grew and the notice never
 * cleared). Each connection resumes from the highest sequence then held and
 * receives only what changed (T3 Code's resume).
 */
function conversationStream(
  queryClient: QueryClient,
  queryKey: ConversationKey,
  signal: AbortSignal,
): AsyncGenerator<AssistantStreamEvent> {
  const [, , schoolId, conversationId] = queryKey;
  const lastHeard = installWakeListeners(queryClient);
  const queryHash = hashKey(queryKey);
  return reconnectingStream<AssistantStreamEvent>({
    signal,
    subscribe: async (streamSignal) => {
      const held = queryClient.getQueryData<AssistantConversationState>(queryKey);
      const cursor = held?.conversation ? held.sequence : null;
      const watch = watchConnection(streamSignal);
      try {
        const events = await assistantClient!.subscribeConversation(
          { schoolId, conversationId, ...(cursor === null ? {} : { afterSequence: cursor }) },
          { signal: watch.signal },
        );
        return watchedEvents(events, watch, queryClient, cursor, () => lastHeard.set(queryHash, Date.now()));
      } catch (error) {
        watch.end();
        throw watch.failure(error);
      }
    },
    delay: reconnectDelay,
    isSynchronized: (event) => event.type === 'synchronized',
    isFinal: isClientError,
    // Nothing is written before the first snapshot, so a first load keeps its spinner.
    onDisconnect: () =>
      queryClient.setQueryData<AssistantConversationState>(queryKey, (state) => state && withConnectionLost(state)),
  });
}

/**
 * One live conversation as a query: the stream's snapshot and events are
 * reduced into state, and the data stays on screen across reconnects
 * (`append`). The stream reconnects by itself, so the only error the query
 * ever sees is a final one (the conversation is gone, not allowed, or the
 * session ended); that is not retried and the chat explains it.
 */
function conversationQueryOptions(
  queryClient: QueryClient,
  schoolId: string,
  conversationId: string,
) {
  const queryKey: ConversationKey = ['assistant', 'conversation', schoolId, conversationId];
  return queryOptions({
    queryKey,
    queryFn: streamedQuery<AssistantStreamEvent, AssistantConversationState>({
      refetchMode: 'append',
      streamFn: ({ signal }) => conversationStream(queryClient, queryKey, signal),
      reducer: applyAssistantEvent,
      initialValue: EMPTY_CONVERSATION_STATE,
    }),
    staleTime: Infinity,
    // A remount (returning to a conversation) restarts a stream that was
    // cancelled while away; it resumes from the cursor, so this is cheap.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Subscribes to one conversation; disabled (no data) while there is none yet. */
function useConversationQuery<T>(
  schoolId: string,
  conversationId: string | null,
  select: (state: AssistantConversationState) => T,
) {
  const queryClient = useQueryClient();
  return useQuery({
    ...conversationQueryOptions(queryClient, schoolId, conversationId ?? ''),
    enabled: Boolean(conversationId),
    select,
  });
}

/**
 * Caches what is derived from a conversation's structure (its items and
 * runs). A streamed text frame replaces the state object but keeps both
 * arrays, so every selector would otherwise redo its work on each frame;
 * with this a frame costs one lookup and returns the same value, so its
 * subscribers do not re-render. `derive` must read nothing that can change
 * while `items` and `runs` stay the same (so not `text` or `synchronized`).
 */
function structural<T>(derive: (state: AssistantConversationState) => T) {
  const cache = new WeakMap<readonly AssistantItemDto[], { runs: readonly AssistantRunDto[]; value: T }>();
  return (state: AssistantConversationState): T => {
    const hit = cache.get(state.items);
    if (hit && hit.runs === state.runs) return hit.value;
    const value = derive(state);
    cache.set(state.items, { runs: state.runs, value });
    return value;
  };
}

const selectTimeline = structural((state) => buildAssistantTimeline(state.items, state.runs));
const selectItemsById = structural((state) => new Map(state.items.map((item) => [item.id, item])));
const selectActiveRun = structural((state) => activeRun(state.runs));
const selectPendingApprovals = structural((state) => pendingApprovals(state.items));
const selectQueuedMessages = structural((state) => queuedMessages(state.items, state.runs));
const selectConfirmedItemIds = structural((state): ReadonlySet<string> => new Set(state.items.map((item) => item.id)));
const selectAnnouncement = structural((state) => assistantAnnouncement(state.items, state.runs, state.openedSequence));
const selectUsage = structural((state) => {
  const usage = state.runs.flatMap((run) => (run.diagnostics ? [run.diagnostics] : []));
  return usage.length ? sumAssistantUsage(usage) : null;
});
const selectLastUserText = structural((state) => lastUserText(state.items) ?? undefined);
/**
 * The open conversation with its attention as of now. The stream holds
 * every run of the conversation, live, so the attention is worked out from
 * them (by the contract's own rule) instead of read from the snapshot, which
 * is only as fresh as the moment it was taken.
 */
const selectConversation = (state: AssistantConversationState): AssistantConversationListItemDto | null =>
  state.conversation ? { ...state.conversation, attention: assistantConversationAttention(state.runs) } : null;
/** Has data on screen, but its connection has dropped or not caught up yet. */
const selectDisconnected = (state: AssistantConversationState) => Boolean(state.conversation) && !state.synchronized;
const selectNothing = () => null;

const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(onChange);
const isOffline = () => !onlineManager.isOnline();
const isOfflineOnServer = () => false;

/**
 * Connection health for one conversation. `reconnecting`: its data is on
 * screen but the stream has dropped (or has not caught up yet). `offline`:
 * the browser has no network. The notice they drive appears only after a
 * grace period, so a quick blip never flashes a banner.
 */
export function useAssistantConnection(schoolId: string, conversationId: string | null) {
  const query = useConversationQuery(schoolId, conversationId, selectDisconnected);
  const offline = useSyncExternalStore(subscribeOnline, isOffline, isOfflineOnServer);
  return { reconnecting: query.data === true && !query.isError, offline };
}

/** Why the conversation cannot be shown, once the service has refused it; null otherwise. */
export function useAssistantConversationFailure(schoolId: string, conversationId: string | null) {
  const query = useConversationQuery(schoolId, conversationId, selectNothing);
  return query.isError ? conversationFailure(query.error) : null;
}

/**
 * The open conversation itself (its title, when it last changed), as its
 * live stream knows it; null until the first snapshot arrives. The history
 * list uses it to show the open conversation even when it is older than the
 * pages loaded so far.
 */
export function useAssistantOpenConversation(schoolId: string, conversationId: string | null) {
  return useConversationQuery(schoolId, conversationId, selectConversation).data ?? null;
}

/** The conversation's rows; undefined until its first snapshot arrives. */
export function useAssistantTimeline(schoolId: string, conversationId: string) {
  return useConversationQuery(schoolId, conversationId, selectTimeline).data;
}

/** One reply's text; streaming frames re-render only this subscriber. */
export function useAssistantReply(schoolId: string, conversationId: string, itemId: string) {
  return useConversationQuery(schoolId, conversationId, (state) => {
    const item = selectItemsById(state).get(itemId);
    const saved = item?.kind === 'assistant_message' ? item.body.text : '';
    return {
      text: state.text[itemId] ?? saved,
      streaming: item?.status === 'streaming',
      at: item?.updatedAt ?? null,
    };
  }).data;
}

export function useAssistantActiveRun(schoolId: string, conversationId: string | null) {
  return useConversationQuery(schoolId, conversationId, selectActiveRun).data;
}

/** Changes waiting for the user's decision, for the composer tray. */
export function useAssistantPendingApprovals(schoolId: string, conversationId: string | null) {
  return useConversationQuery(schoolId, conversationId, selectPendingApprovals).data ?? [];
}

/** Messages queued behind the working run, for the composer tray. */
export function useAssistantQueuedMessages(schoolId: string, conversationId: string | null) {
  return useConversationQuery(schoolId, conversationId, selectQueuedMessages).data ?? [];
}

/**
 * Token usage and estimated cost over the conversation's runs, for the
 * developer diagnostics chip. Null when the service sends no diagnostics.
 */
export function useAssistantConversationUsage(schoolId: string, conversationId: string | null) {
  return useConversationQuery(schoolId, conversationId, selectUsage).data ?? null;
}

const NO_ITEM_IDS: ReadonlySet<string> = new Set();

/** Ids of the items the server has confirmed. */
export function useConfirmedItemIds(schoolId: string, conversationId: string | null): ReadonlySet<string> {
  return useConversationQuery(schoolId, conversationId, selectConfirmedItemIds).data ?? NO_ITEM_IDS;
}

/** The user's latest message in the conversation, for Up-arrow recall. */
export function useLastUserText(schoolId: string, conversationId: string | null): string | undefined {
  return useConversationQuery(schoolId, conversationId, selectLastUserText).data;
}

/** What the chat's live region says right now (see `assistantAnnouncement`). */
export function useAssistantAnnouncement(schoolId: string, conversationId: string | null): string {
  return useConversationQuery(schoolId, conversationId, selectAnnouncement).data ?? '';
}

export function useAssistantStatus(schoolId: string) {
  return useQuery({
    ...assistantOrpc!.getStatus.queryOptions({ input: { schoolId } }),
    staleTime: 60_000,
  });
}

/** How often the history list is asked again while a conversation in it is working or waiting. */
const HISTORY_REFRESH_MS = 4000;

/**
 * The history list, newest first, a page at a time. The service pages by
 * number; the next page exists while the current one is not the last.
 *
 * Each row says what its conversation needs noticing for. Changes to the
 * open conversation arrive over its stream, but the others have no stream
 * here, so while any loaded row is working or waiting for approval the list
 * is asked again every few seconds, and not at all once every row is at
 * rest.
 */
export function useAssistantConversations(schoolId: string) {
  return useInfiniteQuery(
    assistantOrpc!.listConversations.infiniteOptions({
      input: (page: number) => ({ schoolId, page }),
      initialPageParam: 1,
      getNextPageParam: ({ pagination }) =>
        pagination.currentPage < pagination.totalPages ? pagination.currentPage + 1 : undefined,
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) =>
          page.items.some((conversation) => conversation.attention === 'working' || conversation.attention === 'approval'),
        )
          ? HISTORY_REFRESH_MS
          : false,
    }),
  );
}

/**
 * Deletes a conversation for good. Afterwards the history list is asked
 * again, and what this browser kept of the conversation goes too: its live
 * state (so its stream stops) and its unsent draft.
 */
export function useDeleteAssistantConversation(schoolId: string) {
  const queryClient = useQueryClient();
  const userId = useSignedInUserId();
  return useMutation({
    ...assistantOrpc!.deleteConversation.mutationOptions(),
    onSuccess: async ({ id }) => {
      if (userId) writeDraft(sessionDraftStorage(), draftKey(userId, schoolId, id), '');
      queryClient.removeQueries({ queryKey: ['assistant', 'conversation', schoolId, id] });
      await queryClient.invalidateQueries({ queryKey: assistantOrpc!.listConversations.key() });
    },
  });
}

/** Where the user is, so the assistant can resolve "this student". */
function currentPageContext() {
  const title = document.title.trim().slice(0, 200);
  return { path: window.location.pathname.slice(0, 300), ...(title ? { title } : {}) };
}

/**
 * T3 Code's reconnect backoff ("equal jitter"): half the ceiling plus a
 * random half, the ceiling doubling from 2s up to 30s.
 */
export function equalJitterDelay(attempt: number): number {
  const ceiling = Math.min(30_000, 1000 * 2 ** (attempt + 1));
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

const sendKey = (schoolId: string) => ['assistant', 'send', schoolId] as const;

type SendVariables = Parameters<
  NonNullable<ReturnType<NonNullable<typeof assistantOrpc>['sendMessage']['mutationOptions']>['mutationFn']>
>[0];

export function useSendAssistantMessage(schoolId: string, surface: AssistantSurface) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...assistantOrpc!.sendMessage.mutationOptions(),
    mutationKey: sendKey(schoolId),
    // Only network and server failures are retried; a refusal is final.
    // Retrying is safe: the request id makes the server return the original
    // run instead of creating another.
    retry: retryUnlessRefused,
    retryDelay: equalJitterDelay,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantOrpc!.listConversations.key() }),
  });
  const send = (text: string, conversationId: string | null) =>
    mutation.mutateAsync({
      schoolId,
      ...(conversationId ? { conversationId } : {}),
      clientRequestId: crypto.randomUUID(),
      text,
      surface,
      pageContext: currentPageContext(),
    });
  /**
   * Re-sends a failed message with its original request id. Resolves with
   * the send's result, or null when it failed again (the message then shows
   * "Not sent" once more), so the caller can open a conversation it started.
   */
  const resend = async (failed: Mutation<unknown, unknown, SendVariables>) => {
    const variables = failed.state.variables;
    if (!variables) return null;
    queryClient.getMutationCache().remove(failed);
    return mutation.mutateAsync(variables).catch(() => null);
  };
  return { send, resend, isPending: mutation.isPending };
}

/**
 * Whether a surface (a chat, the palette's ask row) is still on screen, with
 * no effect: `ref` goes on the surface's root element, and React runs its
 * cleanup when that element leaves. A request that outlives its surface
 * checks `isAlive()` before acting on the result, so a late answer never
 * moves a user who has already gone elsewhere.
 *
 * The ref handles both ways a ref is released: React calls the returned
 * cleanup; a component that merges refs itself (cmdk) calls it with null.
 */
export function useSurfaceLife() {
  const [life] = useState(() => {
    let alive = false;
    return {
      ref: (element: Element | null) => {
        alive = Boolean(element);
        if (!element) return;
        return () => {
          alive = false;
        };
      },
      isAlive: () => alive,
    };
  });
  return life;
}

export type OptimisticMessage = {
  clientRequestId: string;
  text: string;
  submittedAt: Date;
  delivery: 'sending' | 'failed';
  mutation: Mutation<unknown, unknown, SendVariables>;
};

/**
 * Messages the server has not confirmed yet for one conversation, read from
 * the mutation cache (no component state). A sent message stays until the
 * stream delivers its server copy, so it never blinks out in between.
 */
export function useOptimisticMessages(
  schoolId: string,
  conversationId: string | null,
  confirmedItemIds: ReadonlySet<string>,
): OptimisticMessage[] {
  const mutations = useMutationState({
    filters: { mutationKey: sendKey(schoolId) },
    select: (mutation) => mutation as unknown as Mutation<unknown, unknown, SendVariables>,
  });
  return mutations.flatMap((mutation) => {
    const { variables, status, data, submittedAt } = mutation.state;
    if (!variables) return [];
    const result = data as { conversation: { id: string }; item: { id: string } } | undefined;
    const belongsTo = variables.conversationId ?? result?.conversation.id ?? null;
    if (belongsTo !== conversationId) return [];
    if (status === 'success' && result && confirmedItemIds.has(result.item.id)) return [];
    if (status === 'idle') return [];
    return [
      {
        clientRequestId: variables.clientRequestId,
        text: variables.text,
        submittedAt: new Date(submittedAt),
        delivery: status === 'error' ? 'failed' : 'sending',
        mutation,
      },
    ];
  });
}

/**
 * Every approval decision shares this key, so any chat showing a request
 * (the side panel and the page can show the same one) sees a decision made
 * in another.
 */
const approvalKey = ['assistant', 'approval'] as const;

type ApprovalVariables = { schoolId: string; approvalId: string; decision: AssistantApprovalDecision };

/** A decision that is on its way or has been accepted: it must not be sent again. */
const isDecided = (status: string) => status === 'pending' || status === 'success';

const approvalOf = (variables: unknown) => (variables as ApprovalVariables | undefined)?.approvalId;

/**
 * Sends a decision on a change, once. A request stays in the tray from the
 * service accepting the decision until the stream delivers the updated
 * item, and its buttons and shortcuts must not send a second decision in
 * that gap. The check reads the mutation cache directly, so it also holds
 * for two key presses within one render and across chats.
 */
export function useRespondToApproval() {
  const queryClient = useQueryClient();
  const mutation = useMutation({ ...assistantOrpc!.respondToApproval.mutationOptions(), mutationKey: approvalKey });
  return (variables: ApprovalVariables) => {
    const decided = queryClient
      .getMutationCache()
      .findAll({ mutationKey: approvalKey })
      .some((sent) => approvalOf(sent.state.variables) === variables.approvalId && isDecided(sent.state.status));
    if (!decided) mutation.mutate(variables);
  };
}

/**
 * Where each approval's decision stands, across the app: the decision once
 * made (until its request leaves the tray), or why the last attempt failed,
 * after which it can be made again.
 */
export function useApprovalDecisions() {
  const states = useMutationState({ filters: { mutationKey: approvalKey }, select: (mutation) => mutation.state });
  return (approvalId: string | undefined): { decision: AssistantApprovalDecision | undefined; error: string | null } => {
    const latest = approvalId ? states.filter((state) => approvalOf(state.variables) === approvalId).at(-1) : undefined;
    if (latest && isDecided(latest.status)) {
      return { decision: (latest.variables as ApprovalVariables).decision, error: null };
    }
    if (latest?.status !== 'error') return { decision: undefined, error: null };
    return {
      decision: undefined,
      error: refusalMessage(latest.error) ?? 'The decision could not be sent. Check your connection and try again.',
    };
  };
}

/**
 * Asks a run to stop. Stopping a run that is still queued removes it: the
 * service ends it as stopped when its turn comes, before anything is sent
 * to the model. Each caller gets its own request state, so removing a
 * queued message does not show the working run as stopping.
 */
export function useStopAssistantRun() {
  return useMutation(assistantOrpc!.stopRun.mutationOptions());
}

/**
 * The unsent text of one conversation, kept for the browser tab's session
 * so an interruption (another conversation, a reload) does not lose it.
 * `initialText` is read once, when the chat mounts; `save` stores what the
 * message box holds, and removes the entry once it is empty.
 */
export function useAssistantDraft(schoolId: string, conversationId: string | null) {
  const userId = useSignedInUserId();
  // The conversation the box's text belongs to. It starts as the open one and
  // moves to a conversation the box's first message started (`start`), so
  // what is typed while that first send is on its way lands there too.
  const target = useRef(conversationId);
  const keyOf = (id: string | null) => (userId ? draftKey(userId, schoolId, id) : null);
  const [initialText] = useState(() => {
    const key = keyOf(conversationId);
    return key ? readDraft(sessionDraftStorage(), key) : '';
  });
  return {
    initialText,
    save: (text: string) => {
      const key = keyOf(target.current);
      if (key) writeDraft(sessionDraftStorage(), key, text);
    },
    /**
     * The first message started conversation `id`: `boxText` (what the box
     * holds right now, empty included) becomes that conversation's draft and
     * the shared new-conversation draft is cleared. Called before the chat
     * moves to the conversation, so its next mount reads the text back. Never
     * the text that was sent: the box no longer holds it.
     */
    start: (id: string, boxText: string) => {
      const fresh = keyOf(id);
      const pending = keyOf(null);
      if (fresh && pending) {
        writeDraft(sessionDraftStorage(), fresh, boxText);
        writeDraft(sessionDraftStorage(), pending, '');
      }
      target.current = id;
    },
  };
}

/**
 * The signed-in user's id, or null until the session has loaded. Drafts are
 * kept per user, so none is read or written before it is known.
 */
function useSignedInUserId(): string | null {
  return authClient.useSession().data?.user.id ?? null;
}
