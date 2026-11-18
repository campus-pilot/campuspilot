'use client';

import { useSchoolFeatureCheck } from '@/components/require-feature';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import {
  QUESTION_PAPER_SEED_DRAFT,
  type AssistantAttachmentRef,
  type QuestionPaperSeed,
} from '@campuspilot/assistant-contract/attachments';
import type { AssistantModelTier, AssistantSurface, AssistantToolCallItemDto, AssistantUserMessageItemDto, AssistantViewItemDto } from '@campuspilot/assistant-contract/dto';
import {
  ASSISTANT_LANE_CLASS,
  ASSISTANT_SURFACE_PROPS,
  AssistantComposer,
  type AssistantComposerControls,
  AssistantContextChip,
  AssistantConversationUnavailable,
  AssistantConversationUsage,
  AssistantLiveStatus,
  AssistantModelSwitch,
  AssistantProSuggestion,
  AssistantQueuedMessages,
  AssistantReply,
  AssistantSuggestions,
  AssistantTimeline,
  AssistantUserMessage,
  AssistantVoiceBar,
  AssistantVoiceDock,
  AssistantVoiceButton,
  AssistantVoiceHeader,
  AssistantVoiceNotice,
  AssistantWelcome,
  AttachmentsMissingError,
  attachmentsOnlyLabel,
  sentAttachmentsOf,
  AssistantWorkBar,
  type AssistantApprovalDecision,
  type AssistantSuggestion,
} from '@campuspilot/components/assistant';
import { draftSaved, draftSaveSpent, saveEventsOf, supersededDrafts } from '@campuspilot/components/question-paper/chat-cards-model';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { toast } from '@campuspilot/ui/lib/toast';
import { cn } from '@campuspilot/ui/lib/utils';
import { skipToken, useQuery } from '@tanstack/react-query';
import { ClipboardList, RotateCcw, ShieldCheck, UserPlus, UserRoundX } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';

import { assistantAttachmentOriginalUrl, assistantAttachmentThumbUrl } from '@/lib/assistant-attachments';
import { orpc } from '@/lib/orpc';

import { useApprovalMoney } from './assistant-approval-currency';
import { AssistantApprovalWithSummary } from './assistant-approval-request';
import { AssistantDraftCard, useDraftVerdicts } from './assistant-question-paper';
import { seedFailedOf } from './assistant-question-paper-model';
import { mayStopTurn } from './assistant-conversation-state';
import { missingAttachmentIdsOf, refusalMessage, type AssistantConversationFailure } from './assistant-stream';
import { AssistantViewBlock } from './assistant-view';
import { useAssistantAttachmentUpload } from './use-assistant-attachments';
import { readPageUnderOverlay } from './screen-text';
import { OVERLAY_VOICE_OWNER, useChatVoice } from './voice/use-chat-voice';
import { useVoice } from './voice/use-voice';
import type { VoiceHandlers } from './voice/voice-controller';
import { registerVoiceLauncher } from './voice/voice-launcher';
import { voiceIsOn } from './voice/voice-state';
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
  useConversationModelTier,
  useLastUserText,
  useOptimisticMessages,
  useRespondToApproval,
  useSendAssistantMessage,
  useSignedInUserId,
  useStopAssistantRun,
  useSurfaceLife,
  type OptimisticMessage,
} from './use-assistant';

/** A starter prompt, with the school feature it needs when it is about one. */
type StarterSuggestion = AssistantSuggestion & { feature?: SchoolFeatureKey };

const SUGGESTIONS: readonly StarterSuggestion[] = [
  {
    id: 'teachers',
    icon: UserRoundX,
    label: 'Which classes have no class teacher?',
    prompt: 'Which classes in the current session have no class teacher assigned?',
  },
  {
    id: 'admissions',
    // Admissions belong to student management; a school without it is not offered this.
    feature: 'studentManagement',
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
  /**
   * The sentence the box starts with for a seeded conversation. A surface that
   * is already about the paper (the paper's own screen) passes an empty string:
   * there the box starts empty and the seed still travels with the first message.
   */
  seedText?: string;
  /** The welcome's words, for a surface about one thing; the general welcome otherwise. */
  welcome?: { title: string; text: string };
  /** The shield's tooltip in the message box toolbar, about what the assistant asks before; a surface whose changes are saved without asking says so. */
  trustCue?: string;
  /** The message box's hint, for a surface about one thing. While a turn works the box says it queues a follow-up, whatever this is. */
  placeholder?: string;
  /**
   * The suggestions under a new conversation's box, in place of the general
   * ones. Given ones are shown with a seed too (they are about its paper);
   * the general ones are not.
   */
  suggestions?: readonly AssistantSuggestion[];
  /**
   * Share the conversation this chat starts with the seed's question paper
   * (`shareWithPaper`): everyone who may read the paper may read it, and
   * everyone who may change it may continue it. Only the paper's own screen
   * passes it.
   */
  shareWithPaper?: boolean;
  /**
   * Why this user can read the conversation but not write in it (someone who
   * may only read the paper, or a paper that can no longer change). The
   * message box is replaced by this sentence; null (the default) lets them write.
   */
  readOnlyReason?: string | null;
  /**
   * The voice overlay's chat (`AssistantVoiceOverlay`): it has no message box
   * and shows nothing until voice is started from the top bar. Then it is the
   * voice bar with the assistant in it and, once something was asked, the
   * conversation in a card above. Each session starts a new conversation, and
   * the chat has that conversation only while the session is on. `open` moves
   * the app to a section on request, `openLink` follows a link on the page.
   */
  overlay?: Required<Pick<VoiceHandlers, 'open' | 'openLink'>>;
};

/** A paper chat suggests Pro once the user has sent this many messages on Fast. */
const PRO_SUGGESTION_AFTER_MESSAGES = 3;

/**
 * The chip over the message box: which paper this conversation is about.
 * While the paper loads it says only "Question paper"; when it cannot be read
 * (a wrong link, no access) it says so and the seed is not sent
 * (`useSeedPaper`), so the chip never vouches for a paper that was not found.
 */
function SeedChip({ paper, failed, onRemove }: { paper: { subjectName: string; modeName: string; className: string; examName: string } | undefined; failed: boolean; onRemove: () => void }) {
  const label = failed
    ? 'This question paper could not be opened'
    : paper
      ? `${paper.subjectName} (${paper.modeName}), ${paper.className}, ${paper.examName}`
      : 'Question paper';
  return <AssistantContextChip label={label} onRemove={onRemove} />;
}

/**
 * Reads the paper a seeded conversation is about. A paper that cannot be read
 * (not found, or the person may not see it) makes the seed unusable: the
 * conversation then starts plain, without the seed text in the model's context.
 */
function useSeedPaper(schoolId: string, seed: QuestionPaperSeed | null) {
  const detail = useQuery({
    ...orpc.school.getQuestionPaperDetail.queryOptions({ input: seed ? { ...seed, schoolId } : skipToken }),
    retry: false,
  });
  const failed = seedFailedOf({ hasSeed: seed !== null, hasData: detail.data !== undefined, isError: detail.isError });
  return { paper: detail.data?.paper, failed, usableSeed: failed ? null : seed };
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

/** The name over a message someone else sent in a shared conversation; null for the user's own and for messages that do not say. */
function useAuthorOf() {
  const userId = useSignedInUserId();
  return (item: AssistantUserMessageItemDto) => {
    const author = item.body.author;
    return author && userId !== null && author.userId !== userId ? author.name : null;
  };
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
            attachments={sentAttachmentsOf(message.attachments, {
              previewUrlOf: (attachment) => assistantAttachmentThumbUrl(schoolId, attachment.id),
              originalUrlOf: (attachment) => assistantAttachmentOriginalUrl(schoolId, attachment.id),
            })}
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

/**
 * The conversation's timeline. With no conversation yet (`conversationId`
 * null) or before its first snapshot, it shows the messages on their way
 * (`trailing`) in the same timeline the rows will fill, so the first message
 * stays on screen from the send to the server's copy: the timeline's
 * scroller hides its content until it has scrolled into place, and one
 * mounted anew when the rows arrive would blank the message for a frame.
 */
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
  conversationId: string | null;
  trailing: ReactNode;
  gutterClassName?: string;
  failure: AssistantConversationFailure | null;
  onNewConversation: () => void;
}) {
  const loaded = useAssistantTimeline(schoolId, conversationId);
  const rows = loaded ?? (trailing ? [] : undefined);
  const authorOf = useAuthorOf();
  // Draft cards a later ready draft of the same paper replaced shrink to one quiet line.
  const verdicts = useDraftVerdicts(rows ?? [], conversationId);
  const superseded = supersededDrafts(rows ?? [], verdicts);
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
      // Replies are rows, and there are none before the conversation exists.
      renderReply={(itemId, meta) =>
        conversationId ? <ReplyRow schoolId={schoolId} conversationId={conversationId} itemId={itemId} meta={meta} /> : null
      }
      renderView={(item: AssistantViewItemDto) => <AssistantViewBlock schoolId={schoolId} view={item.body.view} />}
      attachmentPreviewUrl={(attachment: AssistantAttachmentRef) => assistantAttachmentThumbUrl(schoolId, attachment.id)}
      attachmentOriginalUrl={(attachment: AssistantAttachmentRef) => assistantAttachmentOriginalUrl(schoolId, attachment.id)}
      authorOf={authorOf}
      renderCard={(row) => (
        <AssistantDraftCard
          schoolId={schoolId}
          call={row.call}
          // "Draft n": the card's place among this conversation's drafts.
          ordinal={rows.filter((candidate) => candidate.kind === 'card').findIndex((candidate) => candidate.id === row.id) + 1}
          onSendMessage={onSendMessage}
          supersededBy={superseded.get(row.call.id)}
          saveRequested={(request) => draftSaveSpent(saveEventsOf(rows), request)}
          saved={(paper, draftId) => draftSaved(rows, paper, draftId)}
        />
      )}
    />
  );
}

/** The composer toolbar's left side: the conversation's developer diagnostics, when the service sends them. */
function ComposerDiagnostics({ schoolId, conversationId }: { schoolId: string; conversationId: string | null }) {
  const usage = useAssistantConversationUsage(schoolId, conversationId);
  return usage ? <AssistantConversationUsage totals={usage} /> : null;
}

/** A quiet trust cue next to the model picker: a shield, with what the assistant may do on hover or focus. */
function TrustCue({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={text}
          tabIndex={0}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ShieldCheck className="size-3.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

/**
 * What sits in the tray above the message box: the first change waiting for
 * a decision, then messages queued behind the working run (confirmed ones
 * and ones still on their way).
 */
function useTrayRequests(
  schoolId: string,
  conversationId: string | null,
  queuedOptimistic: OptimisticMessage[],
  onRetry: (message: OptimisticMessage) => void,
  /** The user may write in this conversation; someone who only reads it may remove no one's queued message. */
  canWrite: boolean,
) {
  const userId = useSignedInUserId();
  const approvals = useApprovals(schoolId);
  const { mine: pending, waitingFor } = useAssistantPendingApprovals(schoolId, conversationId);
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
  const money = useApprovalMoney(schoolId, first);
  const queue = [
    ...queued.map((item) => ({
      id: item.id,
      text: item.body.text || attachmentsOnlyLabel((item.body.attachments ?? []).map((attachment) => attachment.kind)),
      // Removing a queued message stops its run: the server allows it for one's own, or with the right to continue the chat.
      ...(item.runId === removingRunId
        ? { status: 'Removing…' }
        : mayStopTurn({ canWrite, userId, ownerId: item.body.author?.userId })
          ? { removable: true }
          : {}),
    })),
    ...queuedOptimistic.map((message) => ({
      id: message.clientRequestId,
      text: message.text || attachmentsOnlyLabel(message.attachments.map((attachment) => attachment.kind)),
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
  if (!first && queue.length === 0 && waitingFor.length === 0) return null;
  const decided = approvals.decisionOf(first?.body.approvalId);
  return (
    <>
      {waitingFor.length > 0 ? <WaitingForApproval names={waitingFor} /> : null}
      {first && conversationId ? (
        <AssistantApprovalWithSummary
          key={first.id}
          schoolId={schoolId}
          conversationId={conversationId}
          call={first}
          waiting={pending.length}
          pendingDecision={decided.decision}
          error={decided.error}
          currency={money.currency}
          moneyMaps={money.moneyMaps}
          onDecide={(decision) => approvals.decide(first, decision)}
        />
      ) : null}
      <AssistantQueuedMessages messages={queue} onRemove={removeQueued} />
    </>
  );
}

/** Only the person whose turn asked for a change may approve it; the others in a shared conversation are told whom it waits for. */
function WaitingForApproval({ names }: { names: readonly string[] }) {
  return (
    <p className="px-1 text-xs text-muted-foreground">
      Waiting for {names.join(' and ')} to approve a change.
    </p>
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
  // One timeline whether or not the conversation exists yet, so the first message's send and the
  // conversation it starts share it (see ConversationTimeline).
  return (
    <div className="min-h-0 flex-1">
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
  conversationId: openConversationId,
  surface,
  onConversationStarted,
  onNewConversation,
  compact = false,
  autoFocus = false,
  gutterClassName = 'px-4 sm:px-6',
  seed = null,
  onSeedRemoved,
  seedText = QUESTION_PAPER_SEED_DRAFT,
  welcome: welcomeWords,
  trustCue = 'Asks before changing anything',
  placeholder,
  suggestions,
  shareWithPaper = false,
  readOnlyReason = null,
  overlay,
}: AssistantChatProps) {
  const life = useSurfaceLife();
  // The conversation this chat's first message started, set the moment the send returns. The surface moves
  // to it too (`conversationId` follows), but a page does so through its address, a moment later; the chat
  // does not wait, so its message never belongs to neither the new conversation nor this one in between.
  // The surfaces key their chat so that any other change of conversation remounts it (`useChatKey`).
  const [startedId, setStartedId] = useState<string | null>(null);
  /** Whether the overlay's panel (the conversation over the pill) is shown; the user may hide it to see the page. */
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(true);
  /** Whether the overlay fills the window (its own Full screen button); it never navigates. */
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const voiceSession = useVoice();
  // The overlay's chat is its session's conversation and nothing else: it has one only while that session is on. Once
  // voice ends there is nothing of it on screen, so nothing may keep loading it or stay subscribed to it either.
  const overlaySessionOn = voiceSession.ownerId === OVERLAY_VOICE_OWNER && voiceIsOn(voiceSession);
  const conversationId = overlay ? (overlaySessionOn ? startedId : null) : (openConversationId ?? startedId);
  const attachmentUpload = useAssistantAttachmentUpload(schoolId);
  // The seed only means something for a conversation that has not started.
  const activeSeed = conversationId ? null : seed;
  const seedPaper = useSeedPaper(schoolId, activeSeed);
  const status = useAssistantStatus(schoolId);
  // The default prompt names what the school has: a school without student management has no students to ask about.
  const hasFeature = useSchoolFeatureCheck(schoolId);
  const studentManagement = hasFeature('studentManagement');
  // The general starters, without those about a feature the school does not have.
  const starters = SUGGESTIONS.filter(({ feature }) => feature === undefined || hasFeature(feature));
  const composerPlaceholder = placeholder ?? (studentManagement ? 'Ask about students, classes, exams…' : 'Ask about staff, classes, exams…');
  const { send, resend, isPending: sending } = useSendAssistantMessage(schoolId, surface);
  const stop = useStopAssistantRun();
  const running = useAssistantActiveRun(schoolId, conversationId);
  const confirmed = useConfirmedItemIds(schoolId, conversationId);
  const optimistic = useOptimisticMessages(schoolId, conversationId, confirmed);
  const lastSentText = useLastUserText(schoolId, conversationId);
  // Fast or Pro for the next message: what the user picked here, else what the conversation's latest message used.
  const modelTier = useConversationModelTier(schoolId, conversationId);
  const [pickedTier, setPickedTier] = useState<AssistantModelTier | null>(null);
  const tier = pickedTier ?? modelTier.tier ?? 'standard';
  const [proSuggestionDismissed, setProSuggestionDismissed] = useState(false);
  const connection = useAssistantConnection(schoolId, conversationId);
  const failure = useAssistantConversationFailure(schoolId, conversationId);
  const draft = useAssistantDraft(schoolId, conversationId);
  // What the message box holds, as its draft reports say; for sends that do
  // not come from the box (a retry, a suggestion), whose text stays in it.
  const initialText = draft.initialText || (activeSeed ? seedText : '');
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
    setStartedId(id);
    onConversationStarted(id);
  }

  const retry = (message: OptimisticMessage) =>
    void resend(message.mutation).then((result) => {
      if (result) started(result.conversation.id, boxText.current);
    });
  // While a run works, a new message waits in the tray; otherwise it starts a turn.
  const canWrite = readOnlyReason === null;
  const userId = useSignedInUserId();
  const tray = useTrayRequests(schoolId, conversationId, running ? optimistic : [], retry, canWrite);
  // Removing the seed's chip takes the prefilled sentence out of the box unless the user edited it (then their draft stays).
  // The box stays mounted: remounting it would drop the files attached in it, which are already stored on the server.
  const composer = useRef<AssistantComposerControls>(null);
  const removeSeed = () => {
    composer.current?.clearTextIf(seedText);
    onSeedRemoved?.();
  };
  // A paper chat still on Fast after three messages (the teacher is likely correcting it) suggests Pro once; it never switches by itself.
  const proSuggestion =
    shareWithPaper && canWrite && tier === 'standard' && !proSuggestionDismissed && modelTier.userMessages >= PRO_SUGGESTION_AFTER_MESSAGES ? (
      <AssistantProSuggestion onUsePro={() => setPickedTier('pro')} onDismiss={() => setProSuggestionDismissed(true)} />
    ) : null;
  const seedChip = activeSeed && onSeedRemoved ? <SeedChip paper={seedPaper.paper} failed={seedPaper.failed} onRemove={removeSeed} /> : null;
  // Null when there is nothing to show: the composer draws its request sections only then.
  const requests =
    seedChip || proSuggestion ? (
      <>
        {seedChip}
        {proSuggestion}
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
      attachments,
      seed: seedPaper.usableSeed,
      shareWithPaper,
      tier,
    }).catch((error: unknown) => {
      const missing = missingAttachmentIdsOf(error);
      // The composer marks these tiles, so the failed copy of the message is dropped: its Retry would name the same missing files.
      if (missing) throw new AttachmentsMissingError(refusalMessage(error) ?? 'An attached file is no longer available.', missing);
      throw new Error(refusalMessage(error) ?? 'The message could not be sent. Check your connection and try again.');
    });
    started(result.conversation.id, box.text());
  }

  /** Sends text that did not come from the message box (a suggestion, "Try again"); a failure shows as a toast. */
  const sendDirectly = (text: string) =>
    void sendText(text).catch((error: Error) => toast.error(error.message || 'The message could not be sent.'));

  const disabledReason = status.data && !status.data.available ? status.data.unavailableReason : null;
  // "Try again" asks a failed turn's question again. Not while a message is already on its way or sending is unavailable.
  const canRetry = canWrite && !sending && optimistic.length === 0 && !disabledReason;
  // From the click until the run has ended: the request on its way, then the stop the run has recorded.
  const stopping = stop.isPending || Boolean(running?.stopRequestedAt);
  const welcome = !conversationId && optimistic.length === 0;
  const trailing = !running && optimistic.length ? <OptimisticTurn schoolId={schoolId} messages={optimistic} onRetry={retry} /> : null;

  // Voice mode: a spoken request is this chat's own message, so it goes through the same `send`, with the same seed and sharing.
  const chatVoice = useChatVoice({
    schoolId,
    conversationId,
    send: async (request, intoConversationId) => {
      // A new request brings the panel back: its answer is about to appear there.
      if (overlay) setOverlayPanelOpen(true);
      // The overlay sits over the page the user is asking about, so its requests carry what that page shows.
      const result = await send(request, intoConversationId, { seed: seedPaper.usableSeed, shareWithPaper, screen: Boolean(overlay), tier }).catch((error: unknown) => {
        throw new Error(refusalMessage(error) ?? 'The request could not be sent. Check your connection.');
      });
      return { conversationId: result.conversation.id, runId: result.run.id };
    },
    // The overlay's chat is not on a page of its own: it only follows its session's conversation.
    onConversationStarted: overlay ? setStartedId : (id) => started(id, boxText.current),
    overlay: overlay ? { ...overlay, readScreen: readPageUnderOverlay } : undefined,
  });
  /** Starts voice in the overlay, in a new conversation: the last session's is left behind, for the chat and for the session alike. */
  const startOverlayVoice = () => {
    setStartedId(null);
    setOverlayExpanded(false);
    chatVoice.start({ conversationId: null });
  };
  // Through a ref, so the top bar's button always reaches this render's function and the session this render's handlers, with no effect.
  const launcherRef = (element: HTMLSpanElement | null) => {
    chatVoice.handlersRef(element);
    return element ? registerVoiceLauncher(startOverlayVoice) : undefined;
  };
  // Offered to someone who can send here now, where the school has voice (`getStatus`, never inferred from `available`).
  const voiceOffered = canWrite && !disabledReason && status.data?.voice.available === true;
  // The chat's root: it tells late answers the chat has left, and ends a voice session this chat owns when it leaves.
  const leaveVoice = chatVoice.leave;
  const rootRef = useCallback(
    (element: HTMLDivElement | null) => {
      const release = life.ref(element);
      if (!element) return;
      return () => {
        release?.();
        leaveVoice();
      };
    },
    [life, leaveVoice],
  );
  const voiceNotice = chatVoice.notice ? (
    <AssistantVoiceNotice message={chatVoice.notice.message} problem={chatVoice.notice.tone === 'problem'} onDismiss={chatVoice.dismissNotice} />
  ) : null;
  const notLive = Boolean(conversationId) && !failure && (connection.offline || connection.reconnecting);

  if (overlay) {
    return (
      <TooltipProvider delayDuration={400}>
        <div ref={rootRef} {...ASSISTANT_SURFACE_PROPS} className="flex flex-col gap-2 outline-none">
          <span ref={launcherRef} hidden />
          {chatVoice.on ? (
            <AssistantVoiceDock
              activity={chatVoice.activity}
              levels={chatVoice.levels}
              speech={chatVoice.state.said}
              heard={chatVoice.state.heard}
              heardFinal={chatVoice.state.heardFinal}
              muted={chatVoice.state.muted}
              requests={requests}
              panel={
                welcome ? null : (
                  <ConversationTimeline
                    schoolId={schoolId}
                    conversationId={conversationId}
                    trailing={trailing}
                    gutterClassName={overlayExpanded ? 'px-4 sm:px-8' : 'px-4'}
                    failure={failure}
                    onNewConversation={onNewConversation}
                    stoppingRunId={null}
                  />
                )
              }
              panelOpen={overlayPanelOpen}
              onPanelOpenChange={setOverlayPanelOpen}
              expanded={overlayExpanded}
              onExpandedChange={setOverlayExpanded}
              onMutedChange={chatVoice.setMuted}
              onEnd={chatVoice.end}
            />
          ) : voiceNotice ? (
            <div className="assistant-voice-rise overflow-hidden rounded-2xl border border-surface-outline bg-card shadow-xl">{voiceNotice}</div>
          ) : null}
          <ChatAnnouncer schoolId={schoolId} conversationId={conversationId} />
        </div>
      </TooltipProvider>
    );
  }

  return (
    // Tooltips in the chat wait 400ms, so crossing Send or Copy with the pointer does not pop one (the app's default is instant).
    <TooltipProvider delayDuration={400}>
      <div
        ref={rootRef}
        {...ASSISTANT_SURFACE_PROPS}
        className={cn(
          'flex h-full min-h-0 flex-col outline-none',
          welcome ? cn('justify-center overflow-y-auto py-8', gutterClassName) : 'relative',
        )}
      >
        <span ref={chatVoice.handlersRef} hidden />
        {chatVoice.on && !welcome ? (
          // Over the conversation, which stays as it is: the steps, tables and drafts of a spoken request are its own rows.
          <div className={cn('border-b border-assistant-hairline py-2.5', gutterClassName)}>
            <div className={ASSISTANT_LANE_CLASS}>
              <AssistantVoiceHeader activity={chatVoice.activity} levels={chatVoice.levels} speech={chatVoice.state.said} />
            </div>
          </div>
        ) : null}
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
            chatVoice.on ? (
              <AssistantVoiceHeader hero compact={compact} activity={chatVoice.activity} levels={chatVoice.levels} speech={chatVoice.state.said} />
            ) : (
              <AssistantWelcome compact={compact} {...welcomeWords} />
            )
          ) : (
            <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-background to-transparent" aria-hidden />
          )}
          {notLive ? <ConnectionNotice offline={connection.offline} /> : null}
          <div className={welcome ? 'flex flex-col gap-3' : ASSISTANT_LANE_CLASS}>
            {chatVoice.on ? (
              <AssistantVoiceBar
                activity={chatVoice.activity}
                heard={chatVoice.state.heard}
                heardFinal={chatVoice.state.heardFinal}
                muted={chatVoice.state.muted}
                requests={requests}
                onMutedChange={chatVoice.setMuted}
                onType={chatVoice.end}
                onEnd={chatVoice.end}
              />
            ) : null}
            {/* Kept mounted but hidden in voice mode: unmounting the box would drop what is typed and attached in it. */}
            {/* Read-only keeps the composer, closed with the reason, so its tray (approvals, whose approval is awaited) stays. */}
            <div hidden={chatVoice.on}>
              <AssistantComposer
                controlsRef={composer}
                autoFocus={autoFocus}
                disabledReason={readOnlyReason ?? disabledReason}
                placeholder={running ? 'Queue a follow-up…' : composerPlaceholder}
                onSend={sendText}
                sending={sending}
                lastSentText={lastSentText}
                initialText={initialText}
                attachments={{ upload: attachmentUpload.upload, remove: attachmentUpload.remove, onNotice: (message) => toast.error(message) }}
                onDraftChange={saveDraft}
                requests={
                  chatVoice.on ? null : voiceNotice ? (
                    <>
                      {voiceNotice}
                      {requests}
                    </>
                  ) : (
                    requests
                  )
                }
                leading={<ComposerDiagnostics schoolId={schoolId} conversationId={conversationId} />}
                trailing={
                  <>
                    <TrustCue text={trustCue} />
                    <AssistantModelSwitch tier={tier} onChange={setPickedTier} disabled={!canWrite} />
                    {voiceOffered ? <AssistantVoiceButton onStart={chatVoice.start} /> : null}
                  </>
                }
                stopping={stopping}
                onStop={
                  // Someone else's turn is stopped only with the right to continue the chat; one's own, always.
                  running && mayStopTurn({ canWrite, userId, ownerId: running.userId })
                    ? () =>
                        stop.mutate(
                          { schoolId, runId: running.id },
                          { onError: (error) => toast.error(error.message || 'The assistant could not be stopped.') },
                        )
                    : undefined
                }
              />
            </div>
            {welcome && !chatVoice.on && !readOnlyReason && (suggestions || !activeSeed) ? (
              <AssistantSuggestions suggestions={suggestions ?? starters} onPick={sendDirectly} />
            ) : null}
          </div>
        </div>
        <ChatAnnouncer schoolId={schoolId} conversationId={conversationId} />
      </div>
    </TooltipProvider>
  );
}
