'use client';

import type { AssistantAttachmentRef, QuestionPaperSeed } from '@campuspilot/assistant-contract/attachments';
import { draftSaveSpent, saveDraftMessage, saveEventsOf, unsavedDraftOf, type UnsavedDraft } from '@campuspilot/components/question-paper/chat-cards-model';

import { paperLabelOf, type PaperNames } from '@/components/assistant/assistant-question-paper-model';
import { useDraftVerdicts } from '@/components/assistant/assistant-question-paper';
import { refusalMessage } from '@/components/assistant/assistant-stream';
import { useAssistantTimeline, useSendAssistantMessage } from '@/components/assistant/use-assistant';

import type { QuestionPaperScope } from './question-paper-model';

/**
 * The paper's own assistant: the same assistant as everywhere else, in a
 * conversation that is about this paper from its first message (the seed).
 * It sits beside the paper, so it is recorded as the `panel` surface: a
 * conversation beside a screen, not the assistant's page.
 */
export const PAPER_ASSISTANT_SURFACE = 'panel' as const;

/** The paper as a conversation's seed: its natural key, nothing else. */
export const paperSeedOf = (scope: QuestionPaperScope): QuestionPaperSeed => ({
  kind: 'question_paper',
  sessionId: scope.sessionId,
  examSlug: scope.examSlug,
  classId: scope.classId,
  subjectSlug: scope.subjectSlug,
  modeSlug: scope.modeSlug,
});

/**
 * Starts the paper's conversation with a first message (a description, a PDF
 * with what to do with it, a change to a paper just copied) and resolves with
 * the conversation's id, which the caller puts in the address. `attachments`
 * are files already uploaded for the message. The message shows in the chat
 * at once, like any other sent message. A refusal (the school's limit, a role
 * switched off) rejects with the service's own sentence.
 */
export function useStartPaperConversation(scope: QuestionPaperScope) {
  const { send, isPending } = useSendAssistantMessage(scope.schoolId, PAPER_ASSISTANT_SURFACE);
  const start = async (text: string, attachments: AssistantAttachmentRef[] = []): Promise<string> => {
    try {
      const sent = await send(text, null, { seed: paperSeedOf(scope), attachments });
      return sent.conversation.id;
    } catch (error) {
      throw new Error(refusalMessage(error) ?? 'The assistant could not be reached. Check your connection and try again.');
    }
  };
  return { start, isPending };
}

/** What the paper's conversation holds that the paper's side of the screen shows. */
export type PaperDraft = UnsavedDraft & {
  /** The sentence that asks the assistant to save this draft (`saveDraftMessage`). */
  saveRequest: string;
  /** That sentence was already sent and its save is still under way or done, so asking again would save twice. */
  saveRequested: boolean;
};

/**
 * The assistant's newest draft of this paper that no version holds yet, read
 * from the paper's conversation (the chat beside it subscribes to the same
 * stream, so this adds no request). Null without a conversation, before its
 * first snapshot, and once the draft was saved.
 */
export function usePaperDraft(scope: QuestionPaperScope, chatId: string | null, paper: PaperNames): PaperDraft | null {
  const rows = useAssistantTimeline(scope.schoolId, chatId) ?? [];
  const verdicts = useDraftVerdicts(rows);
  const draft = unsavedDraftOf(rows, scope, verdicts);
  if (!draft) return null;
  const saveRequest = saveDraftMessage(draft.draftId, paperLabelOf(paper));
  return { ...draft, saveRequest, saveRequested: draftSaveSpent(saveEventsOf(rows), saveRequest) };
}
