'use client';

import {
  QUESTION_PAPER_SEED_DRAFT,
  type AssistantAttachmentRef,
  type QuestionPaperSeed,
} from '@campuspilot/assistant-contract/attachments';
import type { AssistantSurface, AssistantToolCallItemDto, AssistantViewItemDto } from '@campuspilot/assistant-contract/dto';
import {
  ASSISTANT_LANE_CLASS,
  ASSISTANT_SURFACE_PROPS,
  AssistantApprovalRequest,
  AssistantComposer,
  AssistantContextChip,
  AssistantConversationUnavailable,
  AssistantConversationUsage,
  AssistantLiveStatus,
  AssistantQueuedMessages,
  AssistantReply,
  AssistantSuggestions,
  AssistantTimeline,
  AssistantUserMessage,
  AssistantWelcome,
  imagesOnlyLabel,
  AssistantWorkBar,
  type AssistantApprovalDecision,
  type AssistantSuggestion,
} from '@campuspilot/components/assistant';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import { toast } from '@campuspilot/ui/lib/toast';
import { cn } from '@campuspilot/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, RotateCcw, ShieldCheck, UserPlus, UserRoundX } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { assistantAttachmentThumbUrl } from '@/lib/assistant-attachments';
import { orpc } from '@/lib/orpc';

import { AssistantDraftCard } from './assistant-question-paper';
import { refusalMessage, type AssistantConversationFailure } from './assistant-stream';
import { AssistantViewBlock } from './assistant-view';
import { useAssistantAttachmentUpload } from './use-assistant-attachments';
import {
  useApprovalDecisions,
  useAssistantActiveRun,
  useAssistantAnnouncement,
  useAssistantConnection,
  useAssistantConversationFailure,
  useAssistantConversationUsage,
  useAssistantDraft,
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
  useSurfaceLife,
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
  /**
   * A first message started a conversation. Called only while this chat is
   * still on screen: if the user left before the answer came back, nothing
   * moves them.
   */
  onConversationStarted: (conversationId: string) => void;
  /**
   * Starts a new conversation the way this surface does (a route, a state
   * reset). Offered when the conversation cannot be shown.
   */
  onNewConversation: () => void;
  /** Smaller headline for tight surfaces (palette, panel). */
  compact?: boolean;
  autoFocus?: boolean;
  /** Horizontal padding around the lane, per surface. */
  gutterClassName?: string;
  /**
   * The screen a new conversation starts from ("Continue in chat" on a
   * question paper). Only used without a `conversationId`: the box starts
   * with a prefilled sentence and a removable chip, and nothing is sent until
   * the user sends (decision D31).
   */
  seed?: QuestionPaperSeed | null;
  /** The user removed the seed's chip: start a plain conversation. */
  onSeedRemoved?: () => void;
};

/** The chip over the message box: which paper this conversation is about. */
function SeedChip({ schoolId, seed, onRemove }: { schoolId: string; seed: QuestionPaperSeed; onRemove: () => void }) {
  const detail = useQuery({ ...orpc.school.getQuestionPaperDetail.queryOptions({ input: { ...seed, schoolId } }), retry: false });
  const paper = detail.data?.paper;
  const label = paper ? `${paper.subjectName} (${paper.modeName}), ${paper.className}, ${paper.examName}` : 'Question paper';
  return <AssistantContextChip label={label} onRemove={onRemove} />;
}

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

/**
 * Deciding on changes. Where a decision stands is shared across the app, so
 * a request stays disabled from the moment it is decided (here or in another
 * chat showing it) until the stream takes it out of the tray; a decision
 * that could not be sent re-enables it and says why, in the request.
 */
function useApprovals(schoolId: string) {
  const respond = useRespondToApproval();
  const decisionOf = useApprovalDecisions();
  const decide = (call: AssistantToolCallItemDto, decision: AssistantApprovalDecision) => {
    if (call.body.approvalId) respond({ schoolId, approvalId: call.body.approvalId, decision });
  };
  return { decide, decisionOf };
}

/**
 * A first message on its way while nothing runs yet: the bubble, then the
 * same work bar and "Thinking" line the server's rows will show, so the
 * confirmed rows replace these without the conversation moving.
 */
function OptimisticTurn({
  schoolId,
  messages,
  onRetry,
}: {
  schoolId: string;
  messages: OptimisticMessage[];
  onRetry: (message: OptimisticMessage) => void;
}) {
  const sending = messages.find((message) => message.delivery === 'sending');
  return (
    <>
      {messages.map((message) => (
        <div key={message.clientRequestId} className="pb-1">
          <AssistantUserMessage
            text={message.text}
            at={message.submittedAt}
            delivery={message.delivery}
            onRetry={() => onRetry(message)}
            attachments={message.attachmentIds.map((id) => ({ id, fileName: 'Attached image', previewUrl: assistantAttachmentThumbUrl(schoolId, id) }))}
          />
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

const FAILURE_MESSAGE: Record<AssistantConversationFailure, string> = {
  unavailable: 'This conversation isn’t available.',
  signed_out: 'You’ve been signed out. Sign in again to continue.',
};

/** What the timeline needs from the chat to act on a turn: asking it again, and showing a stop on its way. */
type TurnActions = {
  /** Undefined while asking again is not possible (a message is already on its way, or sending is unavailable). */
  onRetry?: (text: string) => void;
  /** Sends a message the user chose with a button (a draft card's Save); undefined when sending is not possible now. */
  onSendMessage?: (text: string) => void;
  stoppingRunId: string | null;
};

function ConversationTimeline({
  schoolId,
  conversationId,
  trailing,
  gutterClassName,
  failure,
  onNewConversation,
  onRetry,
  onSendMessage,
  stoppingRunId,
}: TurnActions & {
  schoolId: string;
  conversationId: string;
  trailing: ReactNode;
  gutterClassName?: string;
  failure: AssistantConversationFailure | null;
  onNewConversation: () => void;
}) {
  const rows = useAssistantTimeline(schoolId, conversationId);
  if (failure) {
    // A new conversation does not help someone who is signed out, so only the message shows then.
    return (
      <AssistantConversationUnavailable
        message={FAILURE_MESSAGE[failure]}
        actionLabel={failure === 'unavailable' ? 'New conversation' : undefined}
        onAction={onNewConversation}
      />
    );
  }
  if (!rows) {
    // Shown only if loading takes a moment, so opening a conversation does not flash a spinner.
    return (
      <div className="flex h-full items-center justify-center opacity-0 animate-[assistant-reveal_0s_400ms_forwards]">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  return (
    <AssistantTimeline
      rows={rows}
      onRetry={onRetry}
      stoppingRunId={stoppingRunId}
      trailing={trailing}
      gutterClassName={gutterClassName}
      renderReply={(itemId, meta) => <ReplyRow schoolId={schoolId} conversationId={conversationId} itemId={itemId} meta={meta} />}
      renderView={(item: AssistantViewItemDto) => <AssistantViewBlock schoolId={schoolId} view={item.body.view} />}
      attachmentPreviewUrl={(attachment: AssistantAttachmentRef) => assistantAttachmentThumbUrl(schoolId, attachment.id)}
      renderCard={(row) => (
        <AssistantDraftCard
          schoolId={schoolId}
          call={row.call}
          // "Draft n": the card's place among this conversation's drafts.
          ordinal={rows.filter((candidate) => candidate.kind === 'card').findIndex((candidate) => candidate.id === row.id) + 1}
          onSendMessage={onSendMessage}
        />
      )}
    />
  );
}

/**
 * The composer toolbar's left side: a quiet trust cue, then the
 * conversation's developer diagnostics when the service sends them.
 */
function ComposerToolbar({ schoolId, conversationId }: { schoolId: string; conversationId: string | null }) {
  const usage = useAssistantConversationUsage(schoolId, conversationId);
  return (
    <>
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Asks before changing anything</span>
      {usage ? <AssistantConversationUsage totals={usage} /> : null}
    </>
  );
}

/**
 * What sits in the tray above the message box: the first change waiting for
 * a decision, then messages queued behind the working run (confirmed ones
 * and ones still on their way).
 */
function useTrayRequests(schoolId: string, conversationId: string | null, queuedOptimistic: OptimisticMessage[], onRetry: (message: OptimisticMessage) => void) {
  const approvals = useApprovals(schoolId);
  const pending = useAssistantPendingApprovals(schoolId, conversationId);
  const queued = useAssistantQueuedMessages(schoolId, conversationId);
  // Its own request state, apart from the composer's Stop: removing a queued message is not stopping the working run.
  const remove = useStopAssistantRun();
  const removingRunId = remove.isPending ? remove.variables.runId : null;
  /** Removes a queued message by stopping its run, which has not started (see `useStopAssistantRun`). */
  const removeQueued = (itemId: string) => {
    const item = queued.find((entry) => entry.id === itemId);
    if (!item) return;
    remove.mutate(
      { schoolId, runId: item.runId },
      { onError: (error) => toast.error(error.message || 'The message could not be removed from the queue.') },
    );
  };
  const first = pending[0];
  const queue = [
    ...queued.map((item) => ({
      id: item.id,
      text: item.body.text || imagesOnlyLabel(item.body.attachments?.length ?? 0),
      ...(item.runId === removingRunId ? { status: 'Removing…' } : { removable: true }),
    })),
    ...queuedOptimistic.map((message) => ({
      id: message.clientRequestId,
      text: message.text || imagesOnlyLabel(message.attachmentIds.length),
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
  const decided = approvals.decisionOf(first?.body.approvalId);
  return (
    <>
      {first ? (
        <AssistantApprovalRequest
          key={first.id}
          call={first}
          waiting={pending.length}
          pendingDecision={decided.decision}
          error={decided.error}
          onDecide={(decision) => approvals.decide(first, decision)}
        />
      ) : null}
      <AssistantQueuedMessages messages={queue} onRemove={removeQueued} />
    </>
  );
}

/**
 * The pill over the composer while the conversation is not live. It fades
 * in only after a 2s grace, so a quick blip never flashes it.
 */
function ConnectionNotice({ offline }: { offline: boolean }) {
  return (
    <p
      role="status"
      className="absolute inset-x-0 -top-8 mx-auto flex h-7 w-fit items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 text-xs text-assistant-warning opacity-0 shadow-sm animate-[assistant-reveal_0s_2s_forwards]"
    >
      <Spinner className="size-3" />
      {offline ? 'You’re offline. Reconnecting when you’re back.' : 'Reconnecting…'}
    </p>
  );
}

/**
 * The chat's one live region for screen readers: it speaks when its text
 * changes, so a finished answer is read once (never frame by frame) and a
 * change that needs a decision is named when it appears.
 */
function ChatAnnouncer({ schoolId, conversationId }: { schoolId: string; conversationId: string | null }) {
  const message = useAssistantAnnouncement(schoolId, conversationId);
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

/** The space above the docked composer: the conversation, or a first message on its way. */
function ChatBody({
  schoolId,
  conversationId,
  trailing,
  gutterClassName,
  failure,
  onNewConversation,
  onRetry,
  onSendMessage,
  stoppingRunId,
}: TurnActions & {
  schoolId: string;
  conversationId: string | null;
  trailing: ReactNode;
  gutterClassName: string;
  failure: AssistantConversationFailure | null;
  onNewConversation: () => void;
}) {
  return (
    <div className="min-h-0 flex-1">
      {conversationId ? (
        <ConversationTimeline
          schoolId={schoolId}
          conversationId={conversationId}
          trailing={trailing}
          gutterClassName={gutterClassName}
          failure={failure}
          onNewConversation={onNewConversation}
          onRetry={onRetry}
          onSendMessage={onSendMessage}
          stoppingRunId={stoppingRunId}
        />
      ) : (
        <div className={cn('h-full overflow-y-auto pt-4', gutterClassName)}>
          <div className={ASSISTANT_LANE_CLASS}>{trailing}</div>
        </div>
      )}
    </div>
  );
}

/**
 * A conversation with the assistant. New conversations start as a centred
 * welcome with the composer; once a message is on its way, the timeline
 * fills the space and the composer docks at the bottom of the same lane.
 *
 * Both layouts are one tree: the same three nested elements hold the
 * composer in each, and only their classes and siblings differ. React
 * therefore keeps the composer mounted when the first message turns the
 * welcome into a conversation, so a send that fails can still put the draft
 * back and show its error. Keep the composer's position in that tree fixed.
 */
export function AssistantChat({
  schoolId,
  conversationId,
  surface,
  onConversationStarted,
  onNewConversation,
  compact = false,
  autoFocus = false,
  gutterClassName = 'px-4 sm:px-6',
  seed = null,
  onSeedRemoved,
}: AssistantChatProps) {
  const life = useSurfaceLife();
  const imageUpload = useAssistantAttachmentUpload(schoolId);
  // The seed only means something for a conversation that has not started.
  const activeSeed = conversationId ? null : seed;
  const status = useAssistantStatus(schoolId);
  const { send, resend, isPending: sending } = useSendAssistantMessage(schoolId, surface);
  const stop = useStopAssistantRun();
  const running = useAssistantActiveRun(schoolId, conversationId);
  const confirmed = useConfirmedItemIds(schoolId, conversationId);
  const optimistic = useOptimisticMessages(schoolId, conversationId, confirmed);
  const lastSentText = useLastUserText(schoolId, conversationId);
  const connection = useAssistantConnection(schoolId, conversationId);
  const failure = useAssistantConversationFailure(schoolId, conversationId);
  const draft = useAssistantDraft(schoolId, conversationId);
  // What the message box holds, as its draft reports say; for sends that do
  // not come from the box (a retry, a suggestion), whose text stays in it.
  const initialText = draft.initialText || (activeSeed ? QUESTION_PAPER_SEED_DRAFT : '');
  const boxText = useRef(initialText);
  const saveDraft = (text: string) => {
    boxText.current = text;
    draft.save(text);
  };

  /**
   * A send of this chat started conversation `id`. The box's text moves with
   * it, then the chat follows; neither happens once the user has left this
   * chat, since the answer must not move them or another chat's draft.
   */
  function started(id: string, textInBox: string) {
    if (conversationId || !life.isAlive()) return;
    draft.start(id, textInBox);
    onConversationStarted(id);
  }

  const retry = (message: OptimisticMessage) =>
    void resend(message.mutation).then((result) => {
      if (result) started(result.conversation.id, boxText.current);
    });
  // While a run works, a new message waits in the tray; otherwise it starts a turn.
  const tray = useTrayRequests(schoolId, conversationId, running ? optimistic : [], retry);
  const requests =
    activeSeed && onSeedRemoved ? (
      <>
        <SeedChip schoolId={schoolId} seed={activeSeed} onRemove={onSeedRemoved} />
        {tray}
      </>
    ) : (
      tray
    );

  async function sendText(
    text: string,
    box: { text: () => string } = { text: () => boxText.current },
    attachments: AssistantAttachmentRef[] = [],
  ) {
    const result = await send(text, conversationId, {
      attachmentIds: attachments.map((attachment) => attachment.id),
      seed: activeSeed,
    }).catch((error: unknown) => {
      throw new Error(refusalMessage(error) ?? 'The message could not be sent. Check your connection and try again.');
    });
    started(result.conversation.id, box.text());
  }

  /** Sends text that did not come from the message box (a suggestion, "Try again"); a failure shows as a toast. */
  const sendDirectly = (text: string) =>
    void sendText(text).catch((error: Error) => toast.error(error.message || 'The message could not be sent.'));

  const disabledReason = status.data && !status.data.available ? status.data.unavailableReason : null;
  // "Try again" asks a failed turn's question again. Not while a message is already on its way or sending is unavailable.
  const canRetry = !sending && optimistic.length === 0 && !disabledReason;
  // From the click until the run has ended: the request on its way, then the stop the run has recorded.
  const stopping = stop.isPending || Boolean(running?.stopRequestedAt);
  const welcome = !conversationId && optimistic.length === 0;
  const trailing = !running && optimistic.length ? <OptimisticTurn schoolId={schoolId} messages={optimistic} onRetry={retry} /> : null;
  const notLive = Boolean(conversationId) && !failure && (connection.offline || connection.reconnecting);

  return (
    // Tooltips in the chat wait 400ms, so crossing Send or Copy with the pointer does not pop one (the app's default is instant).
    <TooltipProvider delayDuration={400}>
      <div
        ref={life.ref}
        {...ASSISTANT_SURFACE_PROPS}
        className={cn(
          'flex h-full min-h-0 flex-col outline-none',
          welcome ? cn('justify-center overflow-y-auto py-8', gutterClassName) : 'relative',
        )}
      >
        {welcome ? null : (
          <ChatBody
            schoolId={schoolId}
            conversationId={conversationId}
            trailing={trailing}
            gutterClassName={gutterClassName}
            failure={failure}
            onNewConversation={onNewConversation}
            onRetry={canRetry ? sendDirectly : undefined}
            onSendMessage={canRetry ? sendDirectly : undefined}
            stoppingRunId={stop.isPending ? stop.variables.runId : null}
          />
        )}
        <div
          className={
            welcome
              ? // The welcome composer is as wide as the docked one (the lane), so sending the first message does not resize it.
                cn(ASSISTANT_LANE_CLASS, 'flex flex-col gap-6', compact && 'max-w-xl')
              : // The bottom padding grows to the phone's home-indicator inset when there is one.
                cn('relative pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-[max(1rem,env(safe-area-inset-bottom))]', gutterClassName)
          }
        >
          {welcome ? (
            <AssistantWelcome compact={compact} />
          ) : (
            <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" aria-hidden />
          )}
          {notLive ? <ConnectionNotice offline={connection.offline} /> : null}
          <div className={welcome ? 'flex flex-col gap-3' : ASSISTANT_LANE_CLASS}>
            <AssistantComposer
              autoFocus={autoFocus}
              disabledReason={disabledReason}
              placeholder={running ? 'Queue a follow-up…' : undefined}
              onSend={sendText}
              sending={sending}
              lastSentText={lastSentText}
              initialText={initialText}
              attachments={{ upload: imageUpload.upload, onNotice: (message) => toast.error(message) }}
              onDraftChange={saveDraft}
              requests={requests}
              leading={<ComposerToolbar schoolId={schoolId} conversationId={conversationId} />}
              stopping={stopping}
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
            {welcome && !activeSeed ? (
              <AssistantSuggestions suggestions={SUGGESTIONS} onPick={sendDirectly} />
            ) : null}
          </div>
        </div>
        <ChatAnnouncer schoolId={schoolId} conversationId={conversationId} />
      </div>
    </TooltipProvider>
  );
}
