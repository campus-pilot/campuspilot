'use client';

import type { AssistantSurface, AssistantToolCallItemDto, AssistantViewItemDto } from '@campuspilot/assistant-contract/dto';
import {
  ASSISTANT_LANE_CLASS,
  AssistantApprovalRequest,
  AssistantComposer,
  AssistantLiveStatus,
  AssistantQueuedMessages,
  AssistantReply,
  AssistantSuggestions,
  AssistantTimeline,
  AssistantUserMessage,
  AssistantWelcome,
  AssistantWorkBar,
  type AssistantApprovalDecision,
  type AssistantSuggestion,
} from '@campuspilot/components/assistant';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { toast } from '@campuspilot/ui/lib/toast';
import { cn } from '@campuspilot/ui/lib/utils';
import { ClipboardList, RotateCcw, ShieldCheck, UserPlus, UserRoundX } from 'lucide-react';
import type { ReactNode } from 'react';

import { AssistantViewBlock } from './assistant-view';
import {
  useAssistantActiveRun,
  useAssistantConnection,
  useAssistantPendingApprovals,
  useAssistantQueuedMessages,
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
  {
    id: 'teachers',
    icon: UserRoundX,
    label: 'Which classes have no class teacher?',
    prompt: 'Which classes in the current session have no class teacher assigned?',
  },
  {
    id: 'admissions',
    icon: UserPlus,
    label: 'Show admissions that are not registered yet',
    prompt: 'Show me the admissions that are not registered yet.',
  },
  {
    id: 'exams',
    icon: ClipboardList,
    label: 'Where does each examination stand?',
    prompt: 'Give me an overview of this session’s examinations and where each one stands.',
  },
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

function ReplyRow({
  schoolId,
  conversationId,
  itemId,
  meta,
}: {
  schoolId: string;
  conversationId: string;
  itemId: string;
  meta: boolean;
}) {
  const reply = useAssistantReply(schoolId, conversationId, itemId);
  return <AssistantReply text={reply?.text ?? ''} streaming={reply?.streaming ?? false} at={reply?.at ?? new Date()} meta={meta} />;
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

/**
 * A first message on its way while nothing runs yet: the bubble, then the
 * same work bar and "Thinking" line the server's rows will show, so the
 * confirmed rows replace these without the conversation moving.
 */
function OptimisticTurn({ messages, onRetry }: { messages: OptimisticMessage[]; onRetry: (message: OptimisticMessage) => void }) {
  const sending = messages.find((message) => message.delivery === 'sending');
  return (
    <>
      {messages.map((message) => (
        <div key={message.clientRequestId} className="pb-1">
          <AssistantUserMessage text={message.text} at={message.submittedAt} delivery={message.delivery} onRetry={() => onRetry(message)} />
        </div>
      ))}
      {sending ? (
        <>
          <div className="pb-2.5">
            <AssistantWorkBar state="working" since={sending.submittedAt} until={null} pending={null} changes={0} />
          </div>
          <AssistantLiveStatus label="Thinking" />
        </>
      ) : null}
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
      renderReply={(itemId, meta) => <ReplyRow schoolId={schoolId} conversationId={conversationId} itemId={itemId} meta={meta} />}
      renderView={(item: AssistantViewItemDto) => <AssistantViewBlock schoolId={schoolId} view={item.body.view} />}
    />
  );
}

/** A quiet trust cue on the composer's toolbar. */
const trustCue = (
  <>
    <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
    <span className="truncate">Asks before changing anything</span>
  </>
);

/**
 * What sits in the tray above the message box: the first change waiting for
 * a decision, then messages queued behind the working run (confirmed ones
 * and ones still on their way).
 */
function useTrayRequests(schoolId: string, conversationId: string | null, queuedOptimistic: OptimisticMessage[], onRetry: (message: OptimisticMessage) => void) {
  const approvals = useApprovals(schoolId);
  const pending = useAssistantPendingApprovals(schoolId, conversationId);
  const queued = useAssistantQueuedMessages(schoolId, conversationId);
  const first = pending[0];
  const queue = [
    ...queued.map((item) => ({ id: item.id, text: item.body.text })),
    ...queuedOptimistic.map((message) => ({
      id: message.clientRequestId,
      text: message.text,
      status:
        message.delivery === 'failed' ? (
          <span className="flex items-center gap-1 text-destructive">
            Not sent
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Retry" className="text-destructive" onClick={() => onRetry(message)}>
              <RotateCcw />
            </Button>
          </span>
        ) : (
          'Sending…'
        ),
    })),
  ];
  if (!first && queue.length === 0) return null;
  return (
    <>
      {first ? (
        <AssistantApprovalRequest
          key={first.id}
          call={first}
          waiting={pending.length}
          pendingDecision={approvals.pendingDecision(first.body.approvalId)}
          onDecide={(decision) => approvals.decide(first, decision)}
        />
      ) : null}
      <AssistantQueuedMessages messages={queue} />
    </>
  );
}

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
  const retry = (message: OptimisticMessage) => resend(message.mutation);
  // While a run works, a new message waits in the tray; otherwise it starts a turn.
  const requests = useTrayRequests(schoolId, conversationId, running ? optimistic : [], retry);

  async function sendText(text: string) {
    const result = await send(text, conversationId);
    if (!conversationId) onConversationStarted(result.conversation.id);
  }

  const disabledReason = status.data && !status.data.available ? status.data.unavailableReason : null;
  const composer = (
    <AssistantComposer
      autoFocus={autoFocus}
      disabledReason={disabledReason}
      placeholder={running ? 'Queue a follow-up…' : undefined}
      onSend={sendText}
      lastSentText={lastSentText}
      requests={requests}
      leading={trustCue}
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

  const trailing = !running && optimistic.length ? <OptimisticTurn messages={optimistic} onRetry={retry} /> : null;

  if (!conversationId && optimistic.length === 0) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col justify-center overflow-y-auto py-8', gutterClassName)}>
        <div className={cn(ASSISTANT_LANE_CLASS, 'flex flex-col gap-6', compact ? 'max-w-xl' : 'max-w-2xl')}>
          <AssistantWelcome compact={compact} />
          <div className="flex flex-col gap-3">
            {composer}
            <AssistantSuggestions
              suggestions={SUGGESTIONS}
              onPick={(prompt) => void sendText(prompt).catch((error: Error) => toast.error(error.message || 'The message could not be sent.'))}
            />
          </div>
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
            className="absolute inset-x-0 -top-8 mx-auto flex h-7 w-fit items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 text-xs text-assistant-warning opacity-0 shadow-sm animate-[assistant-reveal_0s_2s_forwards]"
          >
            <Spinner className="size-3" />
            Reconnecting…
          </p>
        ) : null}
        <div className={ASSISTANT_LANE_CLASS}>{composer}</div>
      </div>
    </div>
  );
}
