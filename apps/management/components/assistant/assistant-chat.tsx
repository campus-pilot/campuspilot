'use client';

import type { AssistantSurface, AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import {
  AssistantComposer,
  AssistantEmptyState,
  AssistantReply,
  AssistantTimeline,
  type AssistantApprovalDecision,
  type AssistantSuggestion,
} from '@campuspilot/components/assistant';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { toast } from '@campuspilot/ui/lib/toast';

import {
  useAssistantActiveRun,
  useAssistantReply,
  useAssistantStatus,
  useAssistantTimeline,
  useRespondToApproval,
  useSendAssistantMessage,
  useStopAssistantRun,
} from './use-assistant';

const SUGGESTIONS: readonly AssistantSuggestion[] = [
  { id: 'teachers', label: 'Classes without a teacher', prompt: 'Which classes in the current session have no class teacher assigned?' },
  { id: 'admissions', label: 'Pending admissions', prompt: 'List the admissions that are not registered yet.' },
  { id: 'exams', label: 'Exam overview', prompt: 'Give me an overview of this session’s examinations and where each one stands.' },
];

export type AssistantChatProps = {
  schoolId: string;
  /** Null for a new conversation, which starts with the first message. */
  conversationId: string | null;
  surface: AssistantSurface;
  onConversationStarted: (conversationId: string) => void;
  /** Smaller empty state for tight surfaces (palette, panel). */
  compact?: boolean;
  autoFocus?: boolean;
};

function ReplyRow({ schoolId, conversationId, itemId }: { schoolId: string; conversationId: string; itemId: string }) {
  const reply = useAssistantReply(schoolId, conversationId, itemId);
  return <AssistantReply text={reply?.text ?? ''} streaming={reply?.streaming ?? false} />;
}

function useApprovals(schoolId: string) {
  const respond = useRespondToApproval();
  const decide = (call: AssistantToolCallItemDto, decision: AssistantApprovalDecision) => {
    if (!call.body.approvalId) return;
    respond.mutate(
      { schoolId, approvalId: call.body.approvalId, decision },
      { onError: (error) => toast.error(error.message || 'The decision could not be sent.') },
    );
  };
  const pendingDecision = (approvalId: string | undefined) =>
    respond.isPending && approvalId && respond.variables?.approvalId === approvalId
      ? respond.variables.decision
      : undefined;
  return { decide, pendingDecision };
}

function ConversationTimeline({ schoolId, conversationId }: { schoolId: string; conversationId: string }) {
  const timeline = useAssistantTimeline(schoolId, conversationId);
  const approvals = useApprovals(schoolId);
  if (!timeline.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return (
    <AssistantTimeline
      rows={timeline.data}
      renderReply={(itemId) => <ReplyRow schoolId={schoolId} conversationId={conversationId} itemId={itemId} />}
      onDecide={approvals.decide}
      pendingDecision={approvals.pendingDecision}
    />
  );
}

/**
 * A conversation with the assistant: the timeline and the message box. The
 * surfaces (panel, page, palette) only decide where this sits.
 */
export function AssistantChat({
  schoolId,
  conversationId,
  surface,
  onConversationStarted,
  compact = false,
  autoFocus = false,
}: AssistantChatProps) {
  const status = useAssistantStatus(schoolId);
  const { send } = useSendAssistantMessage(schoolId, surface);
  const stop = useStopAssistantRun();
  const running = useAssistantActiveRun(schoolId, conversationId);

  async function sendText(text: string) {
    const result = await send(text, conversationId);
    if (!conversationId) onConversationStarted(result.conversation.id);
  }

  const disabledReason = status.data && !status.data.available ? status.data.unavailableReason : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {conversationId ? (
          <ConversationTimeline schoolId={schoolId} conversationId={conversationId} />
        ) : (
          <AssistantEmptyState
            compact={compact}
            suggestions={SUGGESTIONS}
            onPick={(prompt) =>
              void sendText(prompt).catch((error: Error) => toast.error(error.message || 'The message could not be sent.'))
            }
          />
        )}
      </div>
      <div className="border-t p-2">
        <AssistantComposer
          autoFocus={autoFocus}
          disabledReason={disabledReason}
          onSend={sendText}
          stopping={stop.isPending}
          onStop={
            running
              ? () =>
                  stop.mutate(
                    { schoolId, runId: running.id },
                    { onError: (error) => toast.error(error.message || 'The assistant could not be stopped.') },
                  )
              : undefined
          }
        />
      </div>
    </div>
  );
}
