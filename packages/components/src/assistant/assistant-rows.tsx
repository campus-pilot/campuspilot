import type {
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
  PencilLine,
  RotateCcw,
  ShieldQuestionMark,
  SquarePen,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AssistantCopyButton } from './assistant-copy-button';
import { AssistantMarkdown } from './assistant-markdown';
import { summarizeActivity, type AssistantWorkState } from './timeline-model';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function MessageTime({ at }: { at: Date }) {
  return (
    <time className="text-xs text-assistant-dim tabular-nums" dateTime={at.toISOString()} title={fullFormat.format(at)}>
      {timeFormat.format(at)}
    </time>
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
}: {
  text: string;
  at: Date;
  delivery?: AssistantMessageDelivery;
  onRetry?: () => void;
}) {
  return (
    <div className="group/message flex flex-col items-end gap-1">
      <h3 className="sr-only">You</h3>
      <div
        className={cn(
          'min-w-0 max-w-[min(80%,32.5rem)] rounded-2xl assistant-bubble px-3.5 py-2.5 text-sm/relaxed text-foreground',
          delivery === 'failed' && 'opacity-70',
        )}
      >
        <CollapsibleMessageText text={text} />
      </div>
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

export function AssistantUserMessageRow({ item }: { item: AssistantUserMessageItemDto }) {
  return <AssistantUserMessage text={item.body.text} at={item.createdAt} />;
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

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

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
  children,
}: {
  state: AssistantWorkState;
  since: Date | null;
  until: Date | null;
  pending: AssistantToolCallItemDto | null;
  changes: number;
  /** The folded work, if there is any. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const foldable = Boolean(children);
  const live = state === 'working';
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
            {live && since ? (
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
              'size-3 shrink-0 text-assistant-dim transition-[rotate,opacity] duration-200 group-data-[state=open]/bar:rotate-90',
              !foldable && 'opacity-0',
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <span className="min-w-0 flex-1" />
        <WorkBarStatus pending={pending} changes={changes} />
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
      <CollapsibleTrigger className="group/activity flex w-full min-w-0 cursor-pointer items-center rounded-md pe-1 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&:hover>span]:text-foreground">
        <WorkRow icon={icon}>
          <span className={cn('truncate', running && 'assistant-shimmer')}>{summarizeActivity(calls)}</span>
        </WorkRow>
        <ChevronRight
          className="size-3 shrink-0 text-assistant-dim transition-[rotate] duration-200 group-data-[state=open]/activity:rotate-90"
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

const NOTICE_TEXT: Record<'failed' | 'cancelled', string> = {
  failed: 'The assistant stopped with an error.',
  cancelled: 'Stopped by you. Changes already made are kept.',
};

/** Why a run ended early, shown where it ended. */
export function AssistantRunNotice({ run, action }: { run: AssistantRunDto; action?: ReactNode }) {
  const status = run.status === 'cancelled' ? 'cancelled' : 'failed';
  return (
    <div
      className={cn(
        'flex min-h-6 items-center gap-1.5 px-1 text-sm/relaxed',
        status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {status === 'failed' ? <AlertCircle className="size-4 shrink-0" aria-hidden /> : null}
      <span>{run.errorMessage ?? NOTICE_TEXT[status]}</span>
      {action}
    </div>
  );
}
