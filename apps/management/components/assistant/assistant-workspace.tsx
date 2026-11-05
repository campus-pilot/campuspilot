'use client';

import type { AssistantConversationDto } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
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
        'flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground md:shrink',
        active && 'bg-accent text-foreground',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{conversation.title ?? 'Conversation'}</span>
      <time className="hidden shrink-0 text-xs text-muted-foreground tabular-nums md:block" dateTime={conversation.updatedAt.toISOString()}>
        {relativeAge(conversation.updatedAt)}
      </time>
    </Link>
  );
}

/** History: a quiet column on desktop, a scrolling row on mobile. */
function ConversationList({ schoolId, conversationId }: { schoolId: string; conversationId: string | null }) {
  const conversations = useAssistantConversations(schoolId);
  return (
    <nav
      aria-label="Conversations"
      className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 md:w-64 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-e md:border-b-0 md:py-3"
    >
      <Button asChild variant="ghost" className="h-8 shrink-0 justify-start gap-2 px-2 text-sm md:mb-2">
        <Link href={conversationHref(schoolId)}>
          <SquarePen /> New conversation
        </Link>
      </Button>
      {conversations.data?.items.map((conversation) => (
        <ConversationLink key={conversation.id} schoolId={schoolId} conversation={conversation} active={conversation.id === conversationId} />
      ))}
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
