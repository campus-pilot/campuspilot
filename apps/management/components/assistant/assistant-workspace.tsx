'use client';

import type { QuestionPaperSeed } from '@campuspilot/assistant-contract/attachments';
import type { AssistantConversationListItemDto } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { cn } from '@campuspilot/ui/lib/utils';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Sparkles, SquarePen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { schoolHref } from '@/components/school-route';

import { FeaturePage } from '@/components/feature-unavailable';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { AssistantAccess } from './assistant-access';
import { AssistantChat } from './assistant-chat';
import { ConversationRow, DeleteConversationDialog, useDeleteConversation } from './assistant-history-row';
import { useAssistantConversations, useAssistantOpenConversation } from './use-assistant';

const conversationHref = (schoolId: string, conversationId?: string) =>
  schoolHref(schoolId, conversationId ? `/assistant/${conversationId}` : '/assistant');

/** One row of the history column that is not a conversation: the control that loads older ones. */
const HISTORY_ROW_CLASS =
  'flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground hover:assistant-ghost-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 md:shrink';

const DAY_MS = 86_400_000;

/** History groups by last activity, in plain words (no spaced capitals). */
function historyGroup(at: Date, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = at.getTime();
  if (time >= startOfToday) return 'Today';
  if (time >= startOfToday - DAY_MS) return 'Yesterday';
  if (time >= startOfToday - 7 * DAY_MS) return 'Previous 7 days';
  return 'Earlier';
}

function groupConversations(conversations: readonly AssistantConversationListItemDto[]) {
  const now = new Date();
  const groups: { label: string; conversations: AssistantConversationListItemDto[] }[] = [];
  for (const conversation of conversations) {
    const label = historyGroup(conversation.updatedAt, now);
    const group = groups.at(-1);
    if (group?.label === label) group.conversations.push(conversation);
    else groups.push({ label, conversations: [conversation] });
  }
  return groups;
}

function HistorySkeleton() {
  return (
    <div className="hidden flex-col gap-1 px-2.5 pt-3 md:flex" aria-hidden>
      {['w-3/4', 'w-1/2', 'w-2/3'].map((width) => (
        <Skeleton key={width} className={cn('my-2 h-3', width)} />
      ))}
    </div>
  );
}

/** The end of the loaded history: a quiet row that fetches the next, older page. */
function ShowOlder({ loading, onShowOlder }: { loading: boolean; onShowOlder: () => void }) {
  return (
    <button type="button" disabled={loading} onClick={onShowOlder} className={cn(HISTORY_ROW_CLASS, 'cursor-pointer disabled:cursor-default')}>
      {loading ? 'Loading…' : 'Show older'}
    </button>
  );
}

/** History that could not be loaded (the list itself, or an older page), with a way to ask again. */
function HistoryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p role="alert" className="flex shrink-0 items-center gap-1 ps-2.5 text-xs whitespace-nowrap text-assistant-dim md:flex-wrap md:pt-3 md:whitespace-normal">
      {message}
      <Button type="button" variant="ghost" size="sm" className="-ms-2 text-muted-foreground" onClick={onRetry}>
        Try again
      </Button>
    </p>
  );
}

/**
 * The loaded pages as one list. Pages are numbered from the newest, so a
 * conversation started between two fetches can push one onto the next page
 * as well; each is kept once.
 */
function loadedConversations(pages: readonly { items: AssistantConversationListItemDto[] }[] | undefined) {
  const seen = new Set<string>();
  return (pages ?? []).flatMap((page) =>
    page.items.filter((conversation) => !seen.has(conversation.id) && Boolean(seen.add(conversation.id))),
  );
}

/** What ends the history list: its loading, empty and error states, and the way to older pages. */
function HistoryEnd({ schoolId, empty }: { schoolId: string; empty: boolean }) {
  const conversations = useAssistantConversations(schoolId);
  if (conversations.isPending) return <HistorySkeleton />;
  if (conversations.isError && !conversations.data) {
    return <HistoryError message="Your conversations couldn’t be loaded." onRetry={() => void conversations.refetch()} />;
  }
  if (conversations.isFetchNextPageError) {
    return <HistoryError message="Older conversations couldn’t be loaded." onRetry={() => void conversations.fetchNextPage()} />;
  }
  if (conversations.hasNextPage) {
    return <ShowOlder loading={conversations.isFetchingNextPage} onShowOlder={() => void conversations.fetchNextPage()} />;
  }
  return empty ? <p className="hidden px-2.5 pt-4 text-xs text-assistant-dim md:block">Your conversations will show here.</p> : null;
}

/**
 * The open conversation when it is not among the loaded history pages (it
 * is older than them, for example opened from a link): it is shown as the
 * first row, so the list always has a selected row. Its title comes from
 * the conversation's own live state. Null while the list is still loading
 * (it may yet turn out to be there) or once a loaded page contains it.
 */
function useOpenConversationOutsideHistory(
  schoolId: string,
  conversationId: string | null,
  loaded: readonly AssistantConversationListItemDto[],
  historyLoaded: boolean,
) {
  const open = useAssistantOpenConversation(schoolId, conversationId);
  if (!open || !historyLoaded || loaded.some((conversation) => conversation.id === open.id)) return null;
  return open;
}

/**
 * History: a quiet column on desktop (slim rows grouped by day), a
 * scrolling row on mobile whose edges fade where more rows continue. Each
 * row can be deleted from its menu, after a confirmation; `onDeleted` tells
 * the page which conversation went, so it can leave it if it was open.
 */
function ConversationList({
  schoolId,
  conversationId,
  onDeleted,
}: {
  schoolId: string;
  conversationId: string | null;
  onDeleted: (conversationId: string) => void;
}) {
  const conversations = useAssistantConversations(schoolId);
  const loaded = loadedConversations(conversations.data?.pages);
  const groups = groupConversations(loaded);
  const openOutside = useOpenConversationOutsideHistory(schoolId, conversationId, loaded, Boolean(conversations.data));
  const deletion = useDeleteConversation(schoolId, onDeleted);
  const row = (conversation: AssistantConversationListItemDto) => (
    <ConversationRow
      key={conversation.id}
      href={conversationHref(schoolId, conversation.id)}
      conversation={conversation}
      active={conversation.id === conversationId}
      onDelete={deletion.ask}
    />
  );
  return (
    <nav
      aria-label="Conversations"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-assistant-hairline px-2 py-2 max-md:scroll-fade-x max-md:[--scroll-fade-size:2rem] md:w-64 md:flex-col md:gap-0 md:overflow-x-visible md:overflow-y-auto md:border-e md:border-b-0"
    >
      <Link
        href={conversationHref(schoolId)}
        aria-current={conversationId ? undefined : 'page'}
        className={cn(
          'group/new flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-foreground outline-none transition-colors hover:assistant-ghost-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
          !conversationId && 'assistant-selected',
        )}
      >
        <SquarePen className="size-[15px] shrink-0 text-muted-foreground transition-colors group-hover/new:text-foreground" aria-hidden />
        New conversation
      </Link>
      {openOutside ? row(openOutside) : null}
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="contents md:flex md:flex-col md:gap-px">
          <h3 className="hidden px-2.5 pt-4 pb-1 text-xs text-assistant-dim md:block">{group.label}</h3>
          {group.conversations.map(row)}
        </section>
      ))}
      <HistoryEnd schoolId={schoolId} empty={groups.length === 0} />
      <DeleteConversationDialog form={deletion.form} />
    </nav>
  );
}

const unavailable = (
  <ModulePlaceholder
    icon={Sparkles}
    title="Assistant unavailable"
    description="Your role cannot use the AI assistant in this school. Your principal or manager can switch it on in Settings."
  />
);

/** While the access check loads: neutral, in the place the answer will take. */
const checkingAccess = (
  <section className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
    <Spinner className="text-muted-foreground" />
  </section>
);

/**
 * Variant 2, full page. It fills the content area edge to edge (cancelling the
 * shell's page padding) so the conversation reads as the page, not a card.
 * The shell's main area grows with its content rather than being a fixed
 * frame, so the height comes from the viewport: minus the 3.5rem header, and
 * on md+ also the inset's 0.5rem top and bottom margins.
 */
export function AssistantWorkspace({
  schoolId,
  conversationId,
  seed = null,
}: {
  schoolId: string;
  conversationId: string | null;
  /** The screen the new conversation starts from (a question paper), read from the address by the page. */
  seed?: QuestionPaperSeed | null;
}) {
  const router = useRouter();
  return (
    // The page exists while the school has the assistant, and only for a user
    // whose role may use it. At the school's limit it stays (the composer
    // then says why it cannot send).
    <FeaturePage feature="assistant">
      <AssistantAccess schoolId={schoolId} fallback={unavailable} pending={checkingAccess}>
      <div className="-m-4 flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col sm:-m-6 md:h-[calc(100dvh-4.5rem)] md:flex-row lg:-m-8">
        <ConversationList
          schoolId={schoolId}
          conversationId={conversationId}
          // Deleting the conversation that is open leaves nothing to show, so a new one takes its place.
          onDeleted={(id) => {
            if (id === conversationId) router.replace(conversationHref(schoolId));
          }}
        />
        <div className="min-h-0 min-w-0 flex-1">
          <AssistantChat
            // Keyed by the conversation only. The seed is deliberately not part of the key: removing its chip
            // clears the address's seed, and a key that followed it would remount the chat and lose the files
            // already attached (stored on the server, never sent).
            key={conversationId ?? 'new'}
            schoolId={schoolId}
            seed={conversationId ? null : seed}
            onSeedRemoved={() => router.replace(conversationHref(schoolId))}
            conversationId={conversationId}
            surface="page"
            autoFocus
            gutterClassName="px-4 sm:px-8 lg:px-12"
            onConversationStarted={(id) => router.replace(conversationHref(schoolId, id))}
            onNewConversation={() => router.push(conversationHref(schoolId))}
          />
        </div>
      </div>
      </AssistantAccess>
    </FeaturePage>
  );
}
