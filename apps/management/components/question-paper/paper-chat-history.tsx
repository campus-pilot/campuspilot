'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { AssistantPaperConversationDto } from '@campuspilot/assistant-contract/dto';
import { AssistantAttentionDot } from '@campuspilot/components/assistant';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { cn } from '@campuspilot/ui/lib/utils';
import { ReadError } from '@/components/exam/exam-common';
import { assistantOrpc } from '@/lib/assistant-client';
import type { QuestionPaperScope } from './question-paper-model';

/** How often an open history is asked again while one of its conversations is working or waiting for approval. */
const HISTORY_REFRESH_MS = 5000;

const updatedOn = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Who started a conversation and when it last changed: the line under its title. */
export const paperConversationDetail = (conversation: Pick<AssistantPaperConversationDto, 'startedByName' | 'updatedAt'>) =>
  [conversation.startedByName ?? 'A former member', updatedOn.format(conversation.updatedAt)].join(' · ');

/**
 * The paper's conversations, newest first, a page at a time (read only while
 * the history is open: its list is mounted then). While one of the loaded ones works or waits for
 * approval the list is asked again every few seconds, as in the assistant's
 * own history.
 */
function usePaperConversations(scope: QuestionPaperScope) {
  const { schoolId, sessionId, examSlug, classId, subjectSlug, modeSlug } = scope;
  return useInfiniteQuery(
    assistantOrpc.listPaperConversations.infiniteOptions({
      input: (page: number) => ({ schoolId, sessionId, examSlug, classId, subjectSlug, modeSlug, page }),
      initialPageParam: 1,
      getNextPageParam: ({ pagination }) => (pagination.currentPage < pagination.totalPages ? pagination.currentPage + 1 : undefined),
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) => page.items.some((conversation) => conversation.attention !== null)) ? HISTORY_REFRESH_MS : false,
    }),
  );
}

/** The list itself: one row per conversation; choosing a row opens it beside the paper. */
function PaperConversationList({
  scope,
  currentId,
  onChoose,
}: {
  scope: QuestionPaperScope;
  currentId: string | null;
  onChoose: (conversationId: string) => void;
}) {
  const list = usePaperConversations(scope);
  // Held pages win over a failed refetch, so the list never blanks under the user.
  if (list.data === undefined) {
    return list.isPending ? <Skeleton className="h-28 w-full rounded-lg" /> : <ReadError error={list.error} retry={list.refetch} />;
  }
  const conversations = list.data.pages.flatMap((page) => page.items);
  if (conversations.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No conversation about this paper yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex max-h-[55dvh] flex-col divide-y overflow-y-auto rounded-lg border">
        {conversations.map((conversation) => {
          const current = conversation.id === currentId;
          return (
            <li key={conversation.id}>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => onChoose(conversation.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
                  current && 'bg-muted/60',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{conversation.title ?? 'Untitled conversation'}</span>
                  <span className="text-xs text-muted-foreground">{paperConversationDetail(conversation)}</span>
                </span>
                {conversation.attention ? <AssistantAttentionDot attention={conversation.attention} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {list.hasNextPage ? (
        <Button type="button" variant="ghost" size="sm" className="self-center" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage ? 'Loading…' : 'Show older conversations'}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The paper's earlier conversations with the assistant, whoever had them: a
 * colleague who takes over the paper reads how it came to be and carries on
 * in any of them. Only conversations about this paper are listed; the
 * assistant's own page keeps each person's full history.
 */
export function PaperChatHistoryDialog({
  scope,
  open,
  onOpenChange,
  currentId,
  onChoose,
}: {
  scope: QuestionPaperScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentId: string | null;
  onChoose: (conversationId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Nothing is pre-focused: a ring on the first row would look like a selection. */}
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Conversations about this paper</DialogTitle>
          <DialogDescription>Everyone who can change this paper sees these, whoever started them.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the list is read when it is asked for and is fresh each time. */}
        {open ? (
          <PaperConversationList
            scope={scope}
            currentId={currentId}
            onChoose={(id) => {
              onOpenChange(false);
              onChoose(id);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
