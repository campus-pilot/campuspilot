'use client';

import { Button } from '@campuspilot/ui/components/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@campuspilot/ui/components/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { Maximize2, SquarePen, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { schoolHref } from '@/components/school-route';

import { AssistantAccess } from './assistant-access';
import { AssistantChat } from './assistant-chat';
import { useChatKey } from './assistant-chat-key';

function PanelHeader({
  schoolId,
  conversationId,
  onNewConversation,
}: {
  schoolId: string;
  conversationId: string | null;
  onNewConversation: () => void;
}) {
  return (
    // As tall as the page header beside it (56px, and 64px where the page sits inset on md+), with the same rule, so the two lines meet.
    <SheetHeader className="h-14 shrink-0 flex-row items-center gap-0.5 border-b py-0 ps-4 pe-2 md:h-16">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <SheetTitle className="text-[13px] font-medium">Assistant</SheetTitle>
        <SheetDescription className="sr-only">Ask the CampusPilot assistant</SheetDescription>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" aria-label="New conversation" onClick={onNewConversation}>
            <SquarePen />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New conversation</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon" className="text-muted-foreground" aria-label="Open full page">
            <Link href={schoolHref(schoolId, conversationId ? `/assistant/${conversationId}` : '/assistant')}>
              <Maximize2 />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open full page</TooltipContent>
      </Tooltip>
      <SheetClose asChild>
        <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" aria-label="Close assistant">
          <X />
        </Button>
      </SheetClose>
    </SheetHeader>
  );
}

/**
 * Variant 1, side panel: opens from the navbar on any page and keeps its
 * conversation while closed, so the user can work and ask side by side.
 */
export function AssistantPanel({ schoolId }: { schoolId: string }) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const chat = useChatKey(conversationId);

  return (
    <AssistantAccess schoolId={schoolId}>
      <Button type="button" variant="ghost" size="icon" aria-label="Open assistant" onClick={() => setOpen(true)}>
        <Sparkles />
      </Button>
      {/* Non-modal: the page stays visible and usable beside the panel, so
          a change the assistant makes can be watched as it lands. Clicking
          the page keeps the panel open; Escape or the close button closes it. */}
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetContent
          side="right"
          showCloseButton={false}
          // Full width on phones (the sheet's own default is three quarters, which leaves a sliver of page behind it).
          className="gap-0 bg-background p-0 shadow-2xl data-[side=right]:w-full data-[side=right]:sm:max-w-md"
          onInteractOutside={(event) => event.preventDefault()}
          // Opening lands in the message box (its autoFocus), not on the first header button.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <PanelHeader
            schoolId={schoolId}
            conversationId={conversationId}
            onNewConversation={() => setConversationId(null)}
          />
          <div className="min-h-0 flex-1">
            <AssistantChat
              // The chat that starts a conversation stays mounted as it moves into it (useChatKey).
              key={chat.key}
              schoolId={schoolId}
              conversationId={conversationId}
              surface="panel"
              compact
              autoFocus
              gutterClassName="px-4"
              onConversationStarted={(id) => {
                chat.started(id);
                setConversationId(id);
              }}
              onNewConversation={() => setConversationId(null)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </AssistantAccess>
  );
}
