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
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { assistantClient, assistantOrpc } from '@/lib/assistant-client';
import { orpc } from '@/lib/orpc';

import {
  applyAssistantEvent,
  EMPTY_CONVERSATION_STATE,
  type AssistantConversationState,
} from './assistant-conversation-state';

/** Thrown when the server ends a live stream, so the query reconnects. */
class StreamClosedError extends Error {}

/**
 * Passes events through and, when a write the assistant made succeeds,
 * refreshes the app's CampusPilot data so open screens show the change.
 */
async function* refreshingStream(
  events: AsyncIterable<AssistantStreamEvent>,
  queryClient: QueryClient,
  signal: AbortSignal,
): AsyncGenerator<AssistantStreamEvent> {
  for await (const event of events) {
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
  if (!signal.aborted) throw new StreamClosedError('The assistant stream closed.');
}

/**
 * One live conversation as a query: the stream's snapshot and events are
 * reduced into state, with reconnect (and a fresh snapshot) on failure.
 */
function conversationQueryOptions(
  queryClient: QueryClient,
  schoolId: string,
  conversationId: string,
) {
  return queryOptions({
    queryKey: ['assistant', 'conversation', schoolId, conversationId] as const,
    queryFn: streamedQuery<AssistantStreamEvent, AssistantConversationState>({
      streamFn: async ({ signal }) =>
        refreshingStream(
          await assistantClient!.subscribeConversation({ schoolId, conversationId }, { signal }),
          queryClient,
          signal,
        ),
      reducer: applyAssistantEvent,
      initialValue: EMPTY_CONVERSATION_STATE,
    }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: true,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
  });
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
    return { text: state.text[itemId] ?? saved, streaming: item?.status === 'streaming' };
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

export function useSendAssistantMessage(schoolId: string, surface: AssistantSurface) {
  const queryClient = useQueryClient();
  const mutation = useMutation(assistantOrpc!.sendMessage.mutationOptions());
  const send = async (text: string, conversationId: string | null) => {
    const result = await mutation.mutateAsync({
      schoolId,
      ...(conversationId ? { conversationId } : {}),
      clientRequestId: crypto.randomUUID(),
      text,
      surface,
      pageContext: currentPageContext(),
    });
    void queryClient.invalidateQueries({ queryKey: assistantOrpc!.listConversations.key() });
    return result;
  };
  return { send, isPending: mutation.isPending };
}

export function useRespondToApproval() {
  return useMutation(assistantOrpc!.respondToApproval.mutationOptions());
}

export function useStopAssistantRun() {
  return useMutation(assistantOrpc!.stopRun.mutationOptions());
}
