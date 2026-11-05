'use client';

import type { AssistantSurface, AssistantToolCallItemDto, AssistantViewItemDto } from '@campuspilot/assistant-contract/dto';
import {
  ASSISTANT_LANE_CLASS,
  AssistantComposer,
  AssistantLiveStatus,
  AssistantReply,
  AssistantSuggestions,
  AssistantTimeline,
  AssistantUserMessage,
  AssistantWelcome,
  type AssistantApprovalDecision,
  type AssistantSuggestion,
} from '@campuspilot/components/assistant';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { toast } from '@campuspilot/ui/lib/toast';
import { cn } from '@campuspilot/ui/lib/utils';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { AssistantViewBlock } from './assistant-view';
import {
  useAssistantActiveRun,
  useAssistantConnection,
  useAssistantReply,
  useAssistantStatus,
  useAssistantTimeline,
  useConfirmedItemIds,
  useLastUserText,
  useOptimisticMessages,
  useRespondToApproval,
  useSendAssistantMessage,
  useStopAssistantRun,
  type OptimisticMessage,
} from './use-assistant';

const SUGGESTIONS: readonly AssistantSuggestion[] = [
  { id: 'teachers', label: 'Which classes have no class teacher?', prompt: 'Which classes in the current session have no class teacher assigned?' },
  { id: 'admissions', label: 'Show admissions that are not registered yet', prompt: 'Show me the admissions that are not registered yet.' },
  { id: 'exams', label: 'Where does each examination stand?', prompt: 'Give me an overview of this session’s examinations and where each one stands.' },
];

export type AssistantChatProps = {
  schoolId: string;
  /** Null for a new conversation, which starts with the first message. */
  conversationId: string | null;
  surface: AssistantSurface;
  onConversationStarted: (conversationId: string) => void;
  /** Smaller headline for tight surfaces (palette, panel). */
  compact?: boolean;
  autoFocus?: boolean;
  /** Horizontal padding around the lane, per surface. */
  gutterClassName?: string;
};

function ReplyRow({ schoolId, conversationId, itemId }: { schoolId: string; conversationId: string; itemId: string }) {
  const reply = useAssistantReply(schoolId, conversationId, itemId);
  return <AssistantReply text={reply?.text ?? ''} streaming={reply?.streaming ?? false} at={reply?.at ?? new Date()} />;
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
    respond.isPending && approvalId && respond.variables?.approvalId === approvalId ? respond.variables.decision : undefined;
  return { decide, pendingDecision };
}

/** Messages not confirmed by the server yet, then a live line while the first one is on its way. */
function OptimisticRows({
  messages,
  onRetry,
  showLive,
}: {
  messages: OptimisticMessage[];
  onRetry: (message: OptimisticMessage) => void;
  showLive: boolean;
}) {
  const first = messages[0];
  return (
    <>
      {messages.map((message) => (
        <div key={message.clientRequestId} className="pb-3">
          <AssistantUserMessage
            text={message.text}
            at={message.submittedAt}
            delivery={message.delivery}
            onRetry={() => onRetry(message)}
          />
        </div>
      ))}
      {showLive && first && first.delivery === 'sending' ? <AssistantLiveStatus label="Thinking" since={first.submittedAt} /> : null}
    </>
  );
}

function ConversationTimeline({
  schoolId,
  conversationId,
  trailing,
  gutterClassName,
}: {
  schoolId: string;
  conversationId: string;
  trailing: ReactNode;
  gutterClassName?: string;
}) {
  const timeline = useAssistantTimeline(schoolId, conversationId);
  const approvals = useApprovals(schoolId);
  if (!timeline.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  return (
    <AssistantTimeline
      rows={timeline.data}
      trailing={trailing}
      gutterClassName={gutterClassName}
      renderReply={(itemId) => <ReplyRow schoolId={schoolId} conversationId={conversationId} itemId={itemId} />}
      renderView={(item: AssistantViewItemDto) => <AssistantViewBlock schoolId={schoolId} view={item.body.view} />}
      onDecide={approvals.decide}
      pendingDecision={approvals.pendingDecision}
    />
  );
}

/** A quiet trust cue on the composer's toolbar. */
const composerLeading = (
  <>
    <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
    <span className="truncate">Asks before changing anything</span>
  </>
);

/**
 * A conversation with the assistant. New conversations start as a centred
 * welcome with the composer; once a message is on its way, the timeline
 * fills the space and the composer docks at the bottom of the same lane.
 */
export function AssistantChat({
  schoolId,
  conversationId,
  surface,
  onConversationStarted,
  compact = false,
  autoFocus = false,
  gutterClassName = 'px-4 sm:px-6',
}: AssistantChatProps) {
  const status = useAssistantStatus(schoolId);
  const { send, resend } = useSendAssistantMessage(schoolId, surface);
  const stop = useStopAssistantRun();
  const running = useAssistantActiveRun(schoolId, conversationId);
  const confirmed = useConfirmedItemIds(schoolId, conversationId);
  const optimistic = useOptimisticMessages(schoolId, conversationId, confirmed);
  const lastSentText = useLastUserText(schoolId, conversationId);
  const connection = useAssistantConnection(schoolId, conversationId);

  async function sendText(text: string) {
    const result = await send(text, conversationId);
    if (!conversationId) onConversationStarted(result.conversation.id);
  }

  const disabledReason = status.data && !status.data.available ? status.data.unavailableReason : null;
  const composer = (
    <AssistantComposer
      autoFocus={autoFocus}
      disabledReason={disabledReason}
      onSend={sendText}
      lastSentText={lastSentText}
      leading={composerLeading}
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
  );

  const trailing = optimistic.length ? (
    <OptimisticRows messages={optimistic} onRetry={(message) => resend(message.mutation)} showLive={!conversationId || !running} />
  ) : null;

  if (!conversationId && optimistic.length === 0) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col justify-center overflow-y-auto py-8', gutterClassName)}>
        <div className={cn(ASSISTANT_LANE_CLASS, 'flex flex-col gap-6', compact ? 'max-w-xl' : 'max-w-2xl')}>
          <AssistantWelcome compact={compact} />
          {composer}
          <AssistantSuggestions
            suggestions={SUGGESTIONS}
            onPick={(prompt) => void sendText(prompt).catch((error: Error) => toast.error(error.message || 'The message could not be sent.'))}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {conversationId ? (
          <ConversationTimeline schoolId={schoolId} conversationId={conversationId} trailing={trailing} gutterClassName={gutterClassName} />
        ) : (
          <div className={cn('h-full overflow-y-auto pt-4', gutterClassName)}>
            <div className={ASSISTANT_LANE_CLASS}>{trailing}</div>
          </div>
        )}
      </div>
      <div className={cn('relative pb-3 sm:pb-4', gutterClassName)}>
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" aria-hidden />
        {connection.reconnecting ? (
          <p
            role="status"
            className="absolute inset-x-0 -top-7 mx-auto w-fit rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground opacity-0 shadow-composer backdrop-blur animate-[assistant-reveal_0s_2s_forwards]"
          >
            Reconnecting…
          </p>
        ) : null}
        <div className={ASSISTANT_LANE_CLASS}>{composer}</div>
      </div>
    </div>
  );
}
