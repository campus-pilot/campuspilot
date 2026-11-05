'use client';

import type { AssistantConversationDto } from '@campuspilot/assistant-contract/dto';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { cn } from '@campuspilot/ui/lib/utils';
import { SquarePen, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ModulePlaceholder } from '@/components/module-placeholder';
import { schoolHref } from '@/components/school-route';

import { AssistantAccess } from './assistant-access';
import { AssistantChat } from './assistant-chat';
import { useAssistantConversations } from './use-assistant';

const conversationHref = (schoolId: string, conversationId?: string) =>
  schoolHref(schoolId, conversationId ? `/assistant/${conversationId}` : '/assistant');

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });

/** "now", "5m", "3h", "2d": compact, like a thread list. */
function relativeAge(at: Date): string {
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : relativeFormat.format(-Math.round(days / 7), 'week');
}

function ConversationLink({
  schoolId,
  conversation,
  active,
}: {
  schoolId: string;
  conversation: AssistantConversationDto;
  active: boolean;
}) {
  return (
    <Link
      href={conversationHref(schoolId, conversation.id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group/conversation flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground hover:assistant-ghost-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 md:shrink',
        active && 'font-medium text-foreground assistant-selected hover:assistant-selected',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{conversation.title ?? 'Untitled conversation'}</span>
      <time
        className="hidden shrink-0 text-xs font-normal text-assistant-dim tabular-nums md:block"
        dateTime={conversation.updatedAt.toISOString()}
      >
        {relativeAge(conversation.updatedAt)}
      </time>
    </Link>
  );
}

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

function groupConversations(conversations: readonly AssistantConversationDto[]) {
  const now = new Date();
  const groups: { label: string; conversations: AssistantConversationDto[] }[] = [];
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

/** History: a quiet column on desktop (slim rows grouped by day), a scrolling row on mobile. */
function ConversationList({ schoolId, conversationId }: { schoolId: string; conversationId: string | null }) {
  const conversations = useAssistantConversations(schoolId);
  const groups = groupConversations(conversations.data?.items ?? []);
  return (
    <nav
      aria-label="Conversations"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-assistant-hairline px-2 py-2 md:w-64 md:flex-col md:gap-0 md:overflow-x-visible md:overflow-y-auto md:border-e md:border-b-0"
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
      {conversations.isPending ? <HistorySkeleton /> : null}
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="contents md:flex md:flex-col md:gap-px">
          <h3 className="hidden px-2.5 pt-4 pb-1 text-xs text-assistant-dim md:block">{group.label}</h3>
          {group.conversations.map((conversation) => (
            <ConversationLink key={conversation.id} schoolId={schoolId} conversation={conversation} active={conversation.id === conversationId} />
          ))}
        </section>
      ))}
      {conversations.isSuccess && groups.length === 0 ? (
        <p className="hidden px-2.5 pt-4 text-xs text-assistant-dim md:block">Your conversations will show here.</p>
      ) : null}
    </nav>
  );
}

const unavailable = (
  <ModulePlaceholder
    icon={Sparkles}
    title="Assistant unavailable"
    description="The assistant is not available for your account in this school."
  />
);

/**
 * Variant 2, full page. It fills the content area edge to edge (cancelling the
 * shell's page padding) so the conversation reads as the page, not a card.
 * The shell's main area grows with its content rather than being a fixed
 * frame, so the height comes from the viewport: minus the 3.5rem header, and
 * on md+ also the inset's 0.5rem top and bottom margins.
 */
export function AssistantWorkspace({ schoolId, conversationId }: { schoolId: string; conversationId: string | null }) {
  const router = useRouter();
  return (
    <AssistantAccess schoolId={schoolId} fallback={unavailable}>
      <div className="-m-4 flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col sm:-m-6 md:h-[calc(100dvh-4.5rem)] md:flex-row lg:-m-8">
        <ConversationList schoolId={schoolId} conversationId={conversationId} />
        <div className="min-h-0 min-w-0 flex-1">
          <AssistantChat
            key={conversationId ?? 'new'}
            schoolId={schoolId}
            conversationId={conversationId}
            surface="page"
            autoFocus
            gutterClassName="px-4 sm:px-8 lg:px-12"
            onConversationStarted={(id) => router.replace(conversationHref(schoolId, id))}
          />
        </div>
      </div>
    </AssistantAccess>
  );
}
