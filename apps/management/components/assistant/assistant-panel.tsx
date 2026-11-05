'use client';

import { Button } from '@campuspilot/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@campuspilot/ui/components/sheet';
import { Maximize2, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { schoolHref } from '@/components/school-route';

import { AssistantAccess } from './assistant-access';
import { AssistantChat } from './assistant-chat';

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
    <SheetHeader className="flex-row items-center gap-1 border-b py-2 pr-12">
      <div className="min-w-0 flex-1">
        <SheetTitle>Assistant</SheetTitle>
        <SheetDescription className="sr-only">Ask the CampusPilot assistant</SheetDescription>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="New conversation" onClick={onNewConversation}>
        <Plus />
      </Button>
      <Button asChild variant="ghost" size="icon-sm" aria-label="Open full page">
        <Link href={schoolHref(schoolId, conversationId ? `/assistant/${conversationId}` : '/assistant')}>
          <Maximize2 />
        </Link>
      </Button>
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

  return (
    <AssistantAccess schoolId={schoolId}>
      <Button type="button" variant="ghost" size="icon" aria-label="Open assistant" onClick={() => setOpen(true)}>
        <Sparkles />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-md">
          <PanelHeader
            schoolId={schoolId}
            conversationId={conversationId}
            onNewConversation={() => setConversationId(null)}
          />
          <div className="min-h-0 flex-1">
            <AssistantChat
              key={conversationId ?? 'new'}
              schoolId={schoolId}
              conversationId={conversationId}
              surface="panel"
              compact
              autoFocus
              onConversationStarted={setConversationId}
            />
          </div>
        </SheetContent>
      </Sheet>
    </AssistantAccess>
  );
}
