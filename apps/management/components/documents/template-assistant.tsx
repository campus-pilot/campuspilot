'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LayoutTemplate, ListChecks, SquarePen, Stamp } from 'lucide-react';
import type { AssistantEditorSource } from '@campuspilot/assistant-contract/template-editing';
import type { AssistantSuggestion } from '@campuspilot/components/assistant';
import { latestTemplateDraftOf, templateDraftsOf } from '@campuspilot/components/documents/template-draft-model';
import { Button } from '@campuspilot/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';

import { AssistantChat } from '@/components/assistant/assistant-chat';
import type { TemplateDraftBinding } from '@/components/assistant/assistant-template-draft';
import { useAssistantTimeline } from '@/components/assistant/use-assistant';
import { chatIdOf } from '@/components/question-paper/question-paper-model';
import { replaceSearchParam } from '@/lib/search-param';

import type { DocumentTemplateScope } from './document-common';

/**
 * The template editor's chat sits beside the template, like a question
 * paper's: it is recorded as the `panel` surface.
 */
const TEMPLATE_ASSISTANT_SURFACE = 'panel' as const;

const TEMPLATE_SUGGESTIONS: readonly AssistantSuggestion[] = [
  {
    id: 'check',
    icon: ListChecks,
    label: 'Check the template for mistakes',
    prompt: 'Check this template for wrong or missing variables and anything that would print badly. Tell me what you find before changing anything.',
  },
  {
    id: 'compact',
    icon: LayoutTemplate,
    label: 'Make the layout cleaner',
    prompt: 'Make the layout cleaner and a little more compact, keeping every value it prints.',
  },
  {
    id: 'heading',
    icon: Stamp,
    label: 'Make the school name stand out',
    prompt: 'Make the school name and logo stand out more in the heading, keeping everything else as it is.',
  },
];

const TEMPLATE_WELCOME = {
  title: 'Ask for an edit',
  text: 'Say what to change in this template. Each draft shows in the preview at once; nothing is saved until you press Save template.',
};

/**
 * The template editor's conversation (docs/document-system.md, "Edit with
 * the assistant"). It is the user's own, private like any chat on the
 * assistant's page, and lives in the editor's address (`?chat=<id>`), so a
 * reload or a save (which remounts the editor on the new revision) carries
 * on in it; without one the first message starts a new conversation. It is
 * not tied to the template: drafts proposed before the template was last
 * saved are history, never offered as unsaved changes.
 *
 * Its drafts are read from the same conversation stream the chat shows, so
 * reading them adds no request. Null `chatId` reads nothing.
 *
 * `chatKey` keys the chat: the chat that starts a conversation stays mounted
 * as the address gains its id, and any other change of conversation (New
 * chat, another id) is a new chat, as on a question paper's screen.
 */
export function useTemplateChat(scope: DocumentTemplateScope, savedAt: Date, enabled: boolean) {
  const search = useSearchParams();
  const [session, setSession] = useState<{ generation: number; started: string | null }>({ generation: 0, started: null });
  const chatId = enabled ? chatIdOf(search.get('chat')) : null;
  const rows = useAssistantTimeline(scope.schoolId, chatId);
  const drafts = templateDraftsOf(rows ?? []);
  const latest = latestTemplateDraftOf(drafts, { schoolId: scope.schoolId, documentType: scope.documentType, savedAt });
  // Rewritten in place (`replaceSearchParam`): switching chats is not a trail for Back, and no navigation refetches the page.
  const setChat = (next: string | null) => replaceSearchParam('chat', next);
  return {
    chatId,
    rows: rows ?? [],
    latest,
    chatKey: chatId === null || chatId === session.started ? `new:${session.generation}` : chatId,
    started: (id: string) => {
      setSession((current) => ({ ...current, started: id }));
      setChat(id);
    },
    startNew: () => {
      setSession((current) => ({ generation: current.generation + 1, started: null }));
      setChat(null);
    },
  };
}

/** Starts a new conversation; shown in the editing pane's header while a conversation is open. */
export function NewTemplateChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="New chat" onClick={onClick}>
          <SquarePen aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>New chat</TooltipContent>
    </Tooltip>
  );
}

/** The assistant's side of the template editor: the ordinary chat, seeded with the template's document type. */
export function TemplateAssistantPane({
  scope,
  chat,
  sourceToSend,
  drafts,
}: {
  scope: DocumentTemplateScope;
  chat: ReturnType<typeof useTemplateChat>;
  /** The editor's source to send with the next message, or null when the conversation already holds it. */
  sourceToSend: () => AssistantEditorSource | null;
  drafts: TemplateDraftBinding;
}) {
  return (
    <AssistantChat
      key={chat.chatKey}
      schoolId={scope.schoolId}
      conversationId={chat.chatId}
      surface={TEMPLATE_ASSISTANT_SURFACE}
      compact
      gutterClassName="px-3"
      seed={{ kind: 'document_template', documentType: scope.documentType }}
      seedText=""
      welcome={TEMPLATE_WELCOME}
      trustCue="Proposes drafts; you save them"
      placeholder="Ask for a change to this template…"
      suggestions={TEMPLATE_SUGGESTIONS}
      templateEditor={{ sourceToSend, drafts }}
      onConversationStarted={chat.started}
      onNewConversation={chat.startNew}
    />
  );
}
