'use client';

import type {
  AssistantStreamEvent,
  AssistantSurface,
} from '@campuspilot/assistant-contract/dto';
import { activeRun, buildAssistantTimeline } from '@campuspilot/components/assistant';
import {
  experimental_streamedQuery as streamedQuery,
  queryOptions,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type Mutation,
  type QueryClient,
} from '@tanstack/react-query';
import { ORPCError } from '@orpc/client';

import { assistantClient, assistantOrpc } from '@/lib/assistant-client';
import { orpc } from '@/lib/orpc';

import {
  applyAssistantEvent,
  EMPTY_CONVERSATION_STATE,
  type AssistantConversationState,
} from './assistant-conversation-state';

/** Thrown when a live stream ends or goes silent, so the query reconnects. */
class StreamClosedError extends Error {}

/**
 * Longest silence accepted from a live stream. The server sends a heartbeat
 * every 15s while idle, so this much silence means a dead connection (for
 * example a half-open socket after a network switch), not a quiet chat.
 */
const STREAM_SILENCE_MS = 40_000;

/** When each live conversation last heard from the server, by query hash. */
const lastHeard = new Map<string, number>();
let wakeListenersInstalled = false;

/**
 * On returning to the tab or regaining the network, conversations that have
 * not heard from the server recently reconnect at once instead of waiting
 * out a backoff. Resuming is cheap: it sends only what changed.
 */
function installWakeListeners(queryClient: QueryClient) {
  if (wakeListenersInstalled || typeof window === 'undefined') return;
  wakeListenersInstalled = true;
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
}

/**
 * Passes events through, watches for silence, and refreshes the app's
 * CampusPilot data when a write the assistant made succeeds, so open screens
 * show the change.
 */
async function* watchedStream(
  events: AsyncIterable<AssistantStreamEvent>,
  queryClient: QueryClient,
  queryHash: string,
  abort: () => void,
  signal: AbortSignal,
): AsyncGenerator<AssistantStreamEvent> {
  let silence = setTimeout(abort, STREAM_SILENCE_MS);
  try {
    for await (const event of events) {
      clearTimeout(silence);
      silence = setTimeout(abort, STREAM_SILENCE_MS);
      lastHeard.set(queryHash, Date.now());
      if (
        event.type === 'item' &&
        event.item.kind === 'tool_call' &&
        event.item.status === 'succeeded' &&
        event.item.body.access === 'write'
      ) {
        void queryClient.invalidateQueries({ queryKey: orpc.school.key() });
      }
      if (event.type === 'run' || event.type === 'conversation') {
        void queryClient.invalidateQueries({ queryKey: assistantOrpc!.listConversations.key() });
      }
      yield event;
    }
  } finally {
    clearTimeout(silence);
  }
  if (!signal.aborted) throw new StreamClosedError('The assistant stream closed.');
}

/**
 * One live conversation as a query: the stream's snapshot and events are
 * reduced into state. On reconnect the data stays on screen (`append`) and
 * the stream resumes from the highest sequence already held, receiving only
 * what changed (T3 Code's resume). Retries use equal-jitter backoff.
 */
function conversationQueryOptions(
  queryClient: QueryClient,
  schoolId: string,
  conversationId: string,
) {
  const queryKey = ['assistant', 'conversation', schoolId, conversationId] as const;
  return queryOptions({
    queryKey,
    queryFn: streamedQuery<AssistantStreamEvent, AssistantConversationState>({
      refetchMode: 'append',
      streamFn: async ({ signal }) => {
        installWakeListeners(queryClient);
        const held = queryClient.getQueryData<AssistantConversationState>(queryKey);
        const controller = new AbortController();
        signal.addEventListener('abort', () => controller.abort(), { once: true });
        const queryHash = queryClient.getQueryCache().find({ queryKey, exact: true })?.queryHash ?? JSON.stringify(queryKey);
        const events = await assistantClient!.subscribeConversation(
          {
            schoolId,
            conversationId,
            ...(held?.conversation ? { afterSequence: held.sequence } : {}),
          },
          { signal: controller.signal },
        );
        return watchedStream(events, queryClient, queryHash, () => controller.abort(), signal);
      },
      reducer: applyAssistantEvent,
      initialValue: EMPTY_CONVERSATION_STATE,
    }),
    staleTime: Infinity,
    // A remount (returning to a conversation) restarts a stream that was
    // cancelled while away; it resumes from the cursor, so this is cheap.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: true,
    retryDelay: (attempt) => equalJitterDelay(attempt),
  });
}

/**
 * Connection health for one conversation: whether it is retrying after a
 * failure. The notice it drives appears only after a grace period, so a
 * quick blip never flashes a banner.
 */
export function useAssistantConnection(schoolId: string, conversationId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...conversationQueryOptions(queryClient, schoolId, conversationId ?? ''),
    enabled: Boolean(conversationId),
    select: () => null,
  });
  return { reconnecting: Boolean(conversationId) && query.failureCount > 0 && query.fetchStatus === 'fetching' };
}

function useConversationQuery<T>(
  schoolId: string,
  conversationId: string,
  select: (state: AssistantConversationState) => T,
) {
  const queryClient = useQueryClient();
  return useQuery({ ...conversationQueryOptions(queryClient, schoolId, conversationId), select });
}

export function useAssistantTimeline(schoolId: string, conversationId: string) {
  return useConversationQuery(schoolId, conversationId, (state) =>
    buildAssistantTimeline(state.items, state.runs),
  );
}

/** One reply's text; streaming frames re-render only this subscriber. */
export function useAssistantReply(schoolId: string, conversationId: string, itemId: string) {
  return useConversationQuery(schoolId, conversationId, (state) => {
    const item = state.items.find((entry) => entry.id === itemId);
    const saved = item?.kind === 'assistant_message' ? item.body.text : '';
    return {
      text: state.text[itemId] ?? saved,
      streaming: item?.status === 'streaming',
      at: item?.updatedAt ?? null,
    };
  }).data;
}

export function useAssistantActiveRun(schoolId: string, conversationId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    ...conversationQueryOptions(queryClient, schoolId, conversationId ?? ''),
    enabled: Boolean(conversationId),
    select: (state) => activeRun(state.runs),
  }).data;
}

function useConversationSelect<T>(
  schoolId: string,
  conversationId: string | null,
  select: (state: AssistantConversationState) => T,
) {
  const queryClient = useQueryClient();
  return useQuery({
    ...conversationQueryOptions(queryClient, schoolId, conversationId ?? ''),
    enabled: Boolean(conversationId),
    select,
  }).data;
}

/** Ids of the items the server has confirmed, as a stable string. */
export function useConfirmedItemIds(schoolId: string, conversationId: string | null): ReadonlySet<string> {
  const ids = useConversationSelect(schoolId, conversationId, (state) => state.items.map((item) => item.id).join(' '));
  return new Set(ids ? ids.split(' ') : []);
}

/** The user's latest message in the conversation, for Up-arrow recall. */
export function useLastUserText(schoolId: string, conversationId: string | null): string | undefined {
  return useConversationSelect(schoolId, conversationId, (state) => {
    const last = [...state.items].reverse().find((item) => item.kind === 'user_message');
    return last?.kind === 'user_message' ? last.body.text : undefined;
  });
}

export function useAssistantStatus(schoolId: string) {
  return useQuery({
    ...assistantOrpc!.getStatus.queryOptions({ input: { schoolId } }),
    staleTime: 60_000,
  });
}

export function useAssistantConversations(schoolId: string) {
  return useQuery(assistantOrpc!.listConversations.queryOptions({ input: { schoolId, page: 1 } }));
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

/**
 * Sends are retried only when the network or server failed; a refusal (for
 * example FORBIDDEN) is final. Retrying is safe: the request id makes the
 * server return the original run instead of creating another.
 */
function retryableSend(failureCount: number, error: unknown) {
  if (failureCount >= 3) return false;
  return !(error instanceof ORPCError) || error.status >= 500;
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
    retry: retryableSend,
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
  /** Re-sends a failed message with its original request id. */
  const resend = (failed: Mutation<unknown, unknown, SendVariables>) => {
    const variables = failed.state.variables;
    if (!variables) return;
    queryClient.getMutationCache().remove(failed);
    void mutation.mutateAsync(variables).catch(() => undefined);
  };
  return { send, resend, isPending: mutation.isPending };
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

export function useRespondToApproval() {
  return useMutation(assistantOrpc!.respondToApproval.mutationOptions());
}

export function useStopAssistantRun() {
  return useMutation(assistantOrpc!.stopRun.mutationOptions());
}
