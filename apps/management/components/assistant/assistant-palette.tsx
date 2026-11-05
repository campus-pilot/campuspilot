'use client';

import { Button } from '@campuspilot/ui/components/button';
import { CommandGroup, CommandItem } from '@campuspilot/ui/components/command';
import { toast } from '@campuspilot/ui/lib/toast';
import { ChevronLeft, Loader2, Maximize2, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { CommandRow } from '@/components/command-row';
import { schoolHref } from '@/components/school-route';

import { AssistantAccess } from './assistant-access';
import { AssistantChat } from './assistant-chat';
import { useSendAssistantMessage } from './use-assistant';

/**
 * Variant 3, command palette: the typed query becomes a question. Sending
 * happens in the select handler, then the palette shows the conversation.
 */
export function AskAssistantCommand({
  schoolId,
  query,
  itemClassName,
  onStarted,
}: {
  schoolId: string;
  query: string;
  itemClassName?: string;
  onStarted: (conversationId: string) => void;
}) {
  const { send, isPending } = useSendAssistantMessage(schoolId, 'palette');
  const question = query.trim();
  if (!question) return null;
  return (
    <AssistantAccess schoolId={schoolId}>
      <CommandGroup heading="Assistant">
        <CommandItem
          className={itemClassName}
          value="assistant:ask"
          disabled={isPending}
          onSelect={() =>
            void send(question, null)
              .then((result) => onStarted(result.conversation.id))
              .catch((error: Error) => toast.error(error.message || 'The assistant could not start.'))
          }
        >
          <CommandRow
            icon={isPending ? Loader2 : Sparkles}
            label={`Ask “${question}”`}
            description={isPending ? 'Starting…' : 'The assistant answers here, with your permissions'}
          />
        </CommandItem>
      </CommandGroup>
    </AssistantAccess>
  );
}

/** The palette's assistant view: a compact chat with a way back to search. */
export function PaletteAssistantView({
  schoolId,
  conversationId,
  onBack,
}: {
  schoolId: string;
  conversationId: string;
  onBack: () => void;
}) {
  return (
    <div className="flex h-[min(32rem,65vh)] flex-col">
      <header className="flex h-10 items-center gap-1 border-b border-assistant-hairline px-1.5">
        <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" aria-label="Back to search" onClick={onBack}>
          <ChevronLeft />
        </Button>
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-[13px] font-medium">Assistant</span>
        <Button asChild variant="ghost" size="icon" className="text-muted-foreground" aria-label="Open full page">
          <Link href={schoolHref(schoolId, `/assistant/${conversationId}`)}>
            <Maximize2 />
          </Link>
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        <AssistantChat
          schoolId={schoolId}
          conversationId={conversationId}
          surface="palette"
          compact
          autoFocus
          onConversationStarted={() => undefined}
        />
      </div>
    </div>
  );
}
