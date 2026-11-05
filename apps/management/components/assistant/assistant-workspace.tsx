'use client';

import type { AssistantConversationDto } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { cn } from '@campuspilot/ui/lib/utils';
import { MessageSquare, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ModulePlaceholder } from '@/components/module-placeholder';
import { schoolHref } from '@/components/school-route';

import { AssistantAccess } from './assistant-access';
import { AssistantChat } from './assistant-chat';
import { useAssistantConversations } from './use-assistant';

const conversationHref = (schoolId: string, conversationId?: string) =>
  schoolHref(schoolId, conversationId ? `/assistant/${conversationId}` : '/assistant');

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
        'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted md:shrink',
        active && 'bg-muted font-medium',
      )}
    >
      <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{conversation.title ?? 'Conversation'}</span>
    </Link>
  );
}

/** Conversation history: a column on desktop, a scrolling row on mobile. */
function ConversationList({ schoolId, conversationId }: { schoolId: string; conversationId: string | null }) {
  const conversations = useAssistantConversations(schoolId);
  return (
    <nav aria-label="Conversations" className="flex min-w-0 flex-col gap-2 md:w-60 md:shrink-0">
      <Button asChild variant="outline" className="self-start">
        <Link href={conversationHref(schoolId)}>
          <Plus /> New conversation
        </Link>
      </Button>
      <div className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {conversations.data?.items.map((conversation) => (
          <ConversationLink
            key={conversation.id}
            schoolId={schoolId}
            conversation={conversation}
            active={conversation.id === conversationId}
          />
        ))}
      </div>
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

/** Variant 2, full page: conversation history beside a full-height chat. */
export function AssistantWorkspace({ schoolId, conversationId }: { schoolId: string; conversationId: string | null }) {
  const router = useRouter();
  return (
    <AssistantAccess schoolId={schoolId} fallback={unavailable}>
      <section className="mx-auto flex h-[calc(100dvh-9rem)] w-full min-w-0 max-w-7xl flex-col gap-4 md:flex-row">
        <ConversationList schoolId={schoolId} conversationId={conversationId} />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border">
          <AssistantChat
            key={conversationId ?? 'new'}
            schoolId={schoolId}
            conversationId={conversationId}
            surface="page"
            autoFocus
            onConversationStarted={(id) => router.replace(conversationHref(schoolId, id))}
          />
        </div>
      </section>
    </AssistantAccess>
  );
}
