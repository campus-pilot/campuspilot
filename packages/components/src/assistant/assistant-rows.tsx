import type { AssistantAttachmentRef } from '@campuspilot/assistant-contract/attachments';
import type {
  AssistantRunDiagnosticsDto,
  AssistantRunDto,
  AssistantToolCallItemDto,
  AssistantUserMessageItemDto,
} from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@campuspilot/ui/components/collapsible';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import {
  AlertCircle,
  Brain,
  ChevronRight,
  CircleSlash,
  Eye,
  Info,
  PencilLine,
  RotateCcw,
  ShieldQuestionMark,
  SquarePen,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AssistantSentAttachments, type SentAttachment } from './assistant-attachment-strip';
import { AssistantCopyButton } from './assistant-copy-button';
import { AssistantRunDiagnostics } from './assistant-diagnostics';
import { AssistantMarkdown } from './assistant-markdown';
import { formatDayAware, formatElapsed, formatStepDuration } from './message-time';
import { plural } from './plural';
import { summarizeActivity, type AssistantWorkState } from './timeline-model';

const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * When a message was sent: the time today, the day as well once it is older
 * (see `formatDayAware`), and the full date and time in a tooltip.
 */
function MessageTime({ at }: { at: Date }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time className="text-xs text-assistant-dim tabular-nums" dateTime={at.toISOString()}>
          {formatDayAware(at)}
        </time>
      </TooltipTrigger>
      <TooltipContent side="bottom">{fullFormat.format(at)}</TooltipContent>
    </Tooltip>
  );
}

/** Hover-revealed over 200ms; always shown on touch, which cannot hover (T3 Code). */
const REVEAL_ON_HOVER =
  'opacity-0 transition-opacity duration-200 group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100';

/** Long messages collapse behind a fade, like T3 Code (8 lines or 600 characters). */
const COLLAPSE_CHARACTERS = 600;
const COLLAPSE_LINES = 8;
const FADE_MASK = 'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)';

function CollapsibleMessageText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.length > COLLAPSE_CHARACTERS || text.split('\n').length > COLLAPSE_LINES;
  const collapsed = collapsible && !expanded;
  return (
    <>
      <p
        className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', collapsed && 'max-h-44 overflow-hidden')}
        style={collapsed ? { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK } : undefined}
      >
        {text}
      </p>
      {collapsible ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-me-2 mt-1 text-muted-foreground"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show less' : 'Show full message'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export type AssistantMessageDelivery = 'sent' | 'sending' | 'failed';

function DeliveryState({ delivery, onRetry }: { delivery: AssistantMessageDelivery; onRetry?: () => void }) {
  if (delivery === 'sending') {
    // Shown only if sending takes a moment, so fast sends never flash it.
    return (
      <p className="flex h-6 items-center pe-1 text-xs text-assistant-dim opacity-0 animate-[assistant-reveal_0s_400ms_forwards]">
        Sending…
      </p>
    );
  }
  if (delivery === 'failed') {
    return (
      <p className="flex h-6 items-center gap-1.5 pe-1 text-xs text-destructive">
        <AlertCircle className="size-3.5" aria-hidden />
        Not sent
        {onRetry ? (
          <Button type="button" variant="ghost" size="sm" className="-me-1 text-destructive hover:text-destructive" onClick={onRetry}>
            <RotateCcw /> Retry
          </Button>
        ) : null}
      </p>
    );
  }
  return null;
}

/**
 * A user turn: a quiet bubble on the right, at most 80% of the lane and
 * 32.5rem, so long questions stay a readable measure (T3 Code).
 */
export function AssistantUserMessage({
  text,
  at,
  delivery = 'sent',
  onRetry,
  attachments = [],
}: {
  text: string;
  at: Date;
  delivery?: AssistantMessageDelivery;
  onRetry?: () => void;
  /** The images sent with the message, shown above its bubble. */
  attachments?: readonly SentAttachment[];
}) {
  return (
    <div className="group/message flex flex-col items-end gap-1">
      <h3 className="sr-only">You</h3>
      <AssistantSentAttachments attachments={attachments} />
      {text ? (
        <div
          className={cn(
            'min-w-0 max-w-[min(80%,32.5rem)] rounded-2xl assistant-bubble px-3.5 py-2.5 text-sm/relaxed text-foreground',
            delivery === 'failed' && 'opacity-70',
          )}
        >
          <CollapsibleMessageText text={text} />
        </div>
      ) : null}
      {delivery === 'sent' ? (
        <div className={cn('flex h-6 items-center gap-0.5 pe-1', REVEAL_ON_HOVER)}>
          <MessageTime at={at} />
          <AssistantCopyButton text={text} />
        </div>
      ) : (
        <DeliveryState delivery={delivery} onRetry={onRetry} />
      )}
    </div>
  );
}

export function AssistantUserMessageRow({
  item,
  attachmentPreviewUrl,
}: {
  item: AssistantUserMessageItemDto;
  /** The thumbnail address of a sent image; null draws a generic tile. */
  attachmentPreviewUrl?: (attachment: AssistantAttachmentRef) => string | null;
}) {
  const attachments = (item.body.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    fileName: attachment.fileName,
    previewUrl: attachment.previewable ? (attachmentPreviewUrl?.(attachment) ?? null) : null,
  }));
  return <AssistantUserMessage text={item.body.text} at={item.createdAt} attachments={attachments} />;
}

/**
 * An assistant turn: prose straight on the canvas, no bubble. Only a
 * finished turn's final answer carries time and copy (`meta`), revealed on
 * hover; the copy glyph sits on the text's edge.
 */
export function AssistantReply({
  text,
  streaming,
  at,
  meta,
}: {
  text: string;
  streaming: boolean;
  at: Date;
  meta: boolean;
}) {
  return (
    <div className="group/message min-w-0 px-1">
      <h3 className="sr-only">Assistant</h3>
      {text ? <AssistantMarkdown text={text} streaming={streaming} /> : null}
      {meta && !streaming && text ? (
        <div className={cn('mt-1 flex h-6 items-center gap-1 [&>button:first-child]:-ms-1.5', REVEAL_ON_HOVER)}>
          <AssistantCopyButton text={text} />
          <MessageTime at={at} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Writes the elapsed time straight into the element once a second, so a
 * ticking clock never re-renders React (T3 Code's tickTextContent).
 */
function tickElapsed(since: Date) {
  return (element: HTMLSpanElement | null) => {
    if (!element) return;
    const write = () => {
      element.textContent = formatElapsed((Date.now() - since.getTime()) / 1000);
    };
    write();
    const timer = setInterval(write, 1000);
    return () => clearInterval(timer);
  };
}

const WORK_LABEL: Record<AssistantWorkState, string> = {
  working: 'Working for',
  paused: 'Paused at',
  done: 'Worked for',
  failed: 'Failed after',
  stopped: 'Stopped at',
};

/** The bar's one status item on the right: what needs the user, else what changed. */
function WorkBarStatus({ pending, changes }: { pending: AssistantToolCallItemDto | null; changes: number }) {
  if (pending) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex h-[22px] min-w-0 shrink items-center gap-1.5 rounded-md bg-assistant-warning/10 px-2 text-xs font-medium text-assistant-warning">
            <ShieldQuestionMark className="size-3 shrink-0" aria-hidden />
            <span className="truncate">Needs approval</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{pending.body.title}: answer below the conversation</TooltipContent>
      </Tooltip>
    );
  }
  if (changes === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <PencilLine className="size-3" aria-hidden />
      {plural(changes, 'change', 'changes')}
    </span>
  );
}

/**
 * A turn's work bar: a 32px line over a hairline (T3 Code). While the turn
 * runs it ticks ("Working for 12s"); once it ends, the turn's work folds
 * under it and the caret opens it. With nothing to fold the caret is hidden
 * but the bar stays, so finishing a turn never shifts the conversation.
 */
export function AssistantWorkBar({
  state,
  since,
  until,
  pending,
  changes,
  stopping = false,
  diagnostics,
  children,
}: {
  state: AssistantWorkState;
  since: Date | null;
  until: Date | null;
  pending: AssistantToolCallItemDto | null;
  changes: number;
  /**
   * The user asked this turn to stop and it has not ended yet. The bar then
   * says "Stopping…" and its clock stops, so it does not keep counting work
   * that is being wound down.
   */
  stopping?: boolean;
  /** Developer diagnostics, shown at the far right when present. */
  diagnostics?: { runId: string; usage: AssistantRunDiagnosticsDto } | null;
  /** The folded work, if there is any. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const foldable = Boolean(children);
  const winding = stopping && (state === 'working' || state === 'paused');
  const live = state === 'working' && !winding;
  const elapsed = since && until ? formatElapsed((until.getTime() - since.getTime()) / 1000) : null;
  const tone = state === 'failed' ? 'text-destructive' : 'text-muted-foreground';
  return (
    <Collapsible open={open} onOpenChange={setOpen} disabled={!foldable}>
      <div className="flex h-8 min-w-0 items-center gap-2.5 border-b border-assistant-hairline ps-1 pe-1">
        <CollapsibleTrigger
          className={cn(
            'group/bar flex shrink-0 items-center gap-1.5 self-stretch rounded-md text-left text-[13px] font-medium whitespace-nowrap tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            tone,
            foldable ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
          )}
        >
          {state === 'failed' ? <AlertCircle className="size-3 shrink-0" aria-hidden /> : null}
          <span>
            {winding ? (
              'Stopping…'
            ) : live && since ? (
              <>
                {WORK_LABEL[state]} <span ref={tickElapsed(since)} />
              </>
            ) : elapsed ? (
              `${WORK_LABEL[state]} ${elapsed}`
            ) : (
              WORK_LABEL[state].replace(/ (for|at|after)$/, '')
            )}
          </span>
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-assistant-dim transition-[rotate,opacity] duration-200 group-data-[state=open]/bar:rotate-90 motion-reduce:transition-none',
              !foldable && 'opacity-0',
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <span className="min-w-0 flex-1" />
        <WorkBarStatus pending={pending} changes={changes} />
        {diagnostics ? <AssistantRunDiagnostics runId={diagnostics.runId} diagnostics={diagnostics.usage} /> : null}
      </div>
      {foldable ? (
        <CollapsibleContent data-assistant-fold-content="" className="flex flex-col pt-2">
          {children}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function ToolIcon({ call }: { call: AssistantToolCallItemDto }) {
  switch (call.status) {
    case 'running':
      return <Spinner className="size-3.5" />;
    case 'failed':
      return <AlertCircle className="size-3.5 text-destructive" aria-label="Failed" />;
    case 'declined':
      return <X className="size-3.5" aria-label="Declined" />;
    case 'cancelled':
      return <CircleSlash className="size-3.5" aria-label="Cancelled" />;
    default:
      return call.body.access === 'write' ? <SquarePen className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />;
  }
}

/** One 24px work row: a muted icon in a fixed slot, then 13px secondary text. */
function WorkRow({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('flex min-h-6 min-w-0 flex-1 items-center gap-1.5 text-[13px] text-muted-foreground', className)}>
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      {children}
    </span>
  );
}

/**
 * How long a finished step took, when that is worth saying (a tenth of a
 * second or more). Shown only for a step that succeeded: its item is
 * created when the step begins and next written when its result is saved,
 * so the two timestamps are exactly its duration. A step that failed or was
 * stopped may have been closed later, when its turn ended, so its
 * timestamps say nothing reliable and it shows none.
 */
function ToolDuration({ call }: { call: AssistantToolCallItemDto }) {
  const duration = call.status === 'succeeded' ? formatStepDuration(call.createdAt, call.updatedAt) : null;
  return duration ? <span className="shrink-0 text-xs text-assistant-dim tabular-nums">{duration}</span> : null;
}

/** One line per group of tool calls; expands to list them (after T3 Code). */
export function AssistantActivity({ calls }: { calls: AssistantToolCallItemDto[] }) {
  const running = calls.some((call) => call.status === 'running');
  const failed = calls.some((call) => call.status === 'failed');
  const writes = calls.some((call) => call.body.access === 'write');
  const icon = running ? (
    <Spinner className="size-3.5" />
  ) : failed ? (
    <AlertCircle className="size-3.5 text-destructive" aria-hidden />
  ) : writes ? (
    <SquarePen className="size-3.5" aria-hidden />
  ) : (
    <Eye className="size-3.5" aria-hidden />
  );
  return (
    <Collapsible className="px-0.5">
      {/* The caret follows its label (6px after it), like the work bar's; the whole row still opens it. */}
      <CollapsibleTrigger className="group/activity flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md pe-1 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&:hover>span]:text-foreground">
        <WorkRow icon={icon} className="flex-initial">
          <span className={cn('truncate', running && 'assistant-shimmer')}>{summarizeActivity(calls)}</span>
        </WorkRow>
        <ChevronRight
          className="size-3 shrink-0 text-assistant-dim transition-[rotate] duration-200 group-data-[state=open]/activity:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col pt-0.5 pb-1">
          {calls.map((call) => (
            <li key={call.id} className="flex min-w-0">
              <WorkRow icon={<ToolIcon call={call} />} className="ps-5">
                <span className="truncate">{call.body.title}</span>
                {call.body.error ? <span className="truncate text-destructive">{call.body.error.message}</span> : null}
                <ToolDuration call={call} />
              </WorkRow>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The live line while the model thinks: a shimmer on the text itself, no dots. */
export function AssistantLiveStatus({ label }: { label: string }) {
  return (
    <div className="px-0.5" role="status">
      <WorkRow icon={<Brain className="size-3.5" aria-hidden />}>
        <span className="assistant-shimmer">{label}</span>
      </WorkRow>
    </div>
  );
}

const NOTICE_TEXT: Record<'failed' | 'cancelled' | 'removed', string> = {
  failed: 'The assistant stopped with an error.',
  cancelled: 'Stopped by you. Changes already made are kept.',
  removed: 'Removed before the assistant started on it.',
};

/**
 * Why a run ended early, shown where it ended, as a quiet work row: the
 * bar above it already carries the red, so the reason does not shout a
 * second time. On the latest turn it offers "Try again" (`onRetry`), which
 * asks the same question again; it is a button only, never a shortcut,
 * because asking again starts a new paid run.
 */
export function AssistantRunNotice({ run, onRetry }: { run: AssistantRunDto; onRetry?: () => void }) {
  // A run stopped before it began was a queued message the user removed.
  const reason = run.status !== 'cancelled' ? 'failed' : run.startedAt ? 'cancelled' : 'removed';
  const Icon = reason === 'failed' ? Info : CircleSlash;
  return (
    <div className="flex min-w-0 items-start gap-1.5 px-0.5 text-[13px]/6 text-muted-foreground">
      <span className="flex h-6 w-5 shrink-0 items-center justify-center">
        <Icon className="size-3.5" aria-hidden />
      </span>
      {/* The action follows the reason on one line, or wraps under it, lined up with its text (the button's own padding is pulled back). */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3">
        <p className="min-w-0">{run.errorMessage ?? NOTICE_TEXT[reason]}</p>
        {onRetry ? (
          <Button type="button" variant="ghost" size="sm" className="-ms-2 text-muted-foreground" onClick={onRetry}>
            <RotateCcw /> Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
