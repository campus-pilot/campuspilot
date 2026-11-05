import type {
  AssistantRunDto,
  AssistantToolCallItemDto,
  AssistantUserMessageItemDto,
} from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@campuspilot/ui/components/collapsible';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { cn } from '@campuspilot/ui/lib/utils';
import {
  AlertCircle,
  Check,
  ChevronRight,
  CircleSlash,
  Copy,
  PencilLine,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AssistantMarkdown } from './assistant-markdown';
import { summarizeActivity } from './timeline-model';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Copies text; the icon turns into a check for a moment (UI state only). */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground hover:text-foreground"
      aria-label={copied ? 'Copied' : 'Copy message'}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

/**
 * Timestamp and copy under a message, revealed on hover or focus (always
 * shown on touch screens, which cannot hover), as in T3 Code.
 */
function MessageMeta({ text, at, align }: { text: string; at: Date; align: 'start' | 'end' }) {
  return (
    <div
      className={cn(
        'flex h-6 items-center gap-1 text-xs text-muted-foreground tabular-nums opacity-0 transition-opacity duration-200 group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
        align === 'end' ? 'flex-row-reverse pe-1' : 'ps-0.5',
      )}
    >
      <CopyButton text={text} />
      <time dateTime={at.toISOString()} title={fullFormat.format(at)}>
        {timeFormat.format(at)}
      </time>
    </div>
  );
}

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
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="-ms-1 mt-1.5 text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show full message'}
        </Button>
      ) : null}
    </>
  );
}

export type AssistantMessageDelivery = 'sent' | 'sending' | 'failed';

function DeliveryState({ delivery, onRetry }: { delivery: AssistantMessageDelivery; onRetry?: () => void }) {
  if (delivery === 'sending') {
    // Shown only if sending takes a moment, so fast sends never flash it.
    return (
      <p className="flex h-6 items-center pe-1 text-xs text-muted-foreground opacity-0 animate-[assistant-reveal_0s_400ms_forwards]">
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
          <Button type="button" variant="link" size="xs" className="h-auto px-0 text-xs" onClick={onRetry}>
            <RotateCcw /> Retry
          </Button>
        ) : null}
      </p>
    );
  }
  return null;
}

/** A user turn: a quiet bubble on the right, at most 80% of the lane. */
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
          'min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-sm/relaxed text-foreground',
          delivery === 'failed' && 'opacity-70',
        )}
      >
        <CollapsibleMessageText text={text} />
      </div>
      {delivery === 'sent' ? <MessageMeta text={text} at={at} align="end" /> : <DeliveryState delivery={delivery} onRetry={onRetry} />}
    </div>
  );
}

export function AssistantUserMessageRow({ item }: { item: AssistantUserMessageItemDto }) {
  return <AssistantUserMessage text={item.body.text} at={item.createdAt} />;
}

/** An assistant turn: prose straight on the canvas, no bubble. */
export function AssistantReply({ text, streaming, at }: { text: string; streaming: boolean; at: Date }) {
  return (
    <div className="group/message min-w-0 px-1">
      <h3 className="sr-only">Assistant</h3>
      {text ? <AssistantMarkdown text={text} streaming={streaming} /> : null}
      {!streaming && text ? <MessageMeta text={text} at={at} align="start" /> : null}
    </div>
  );
}

function ToolStatusIcon({ call }: { call: AssistantToolCallItemDto }) {
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
      return call.body.access === 'write' ? (
        <PencilLine className="size-3.5" aria-hidden />
      ) : (
        <Search className="size-3.5" aria-hidden />
      );
  }
}

/** One muted line per group of tool calls; expands to list them (after T3 Code). */
export function AssistantActivity({ calls }: { calls: AssistantToolCallItemDto[] }) {
  const running = calls.some((call) => call.status === 'running');
  const failed = calls.some((call) => call.status === 'failed');
  return (
    <Collapsible className="px-1">
      <CollapsibleTrigger className="group/activity flex min-h-6 max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-sm/relaxed text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {running ? <Spinner className="size-3.5" /> : failed ? <AlertCircle className="size-3.5 text-destructive" /> : <Search className="size-3.5" />}
        </span>
        <span className={cn('truncate', running && 'assistant-shimmer')}>{summarizeActivity(calls)}</span>
        <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-[opacity,rotate] duration-200 group-hover/activity:opacity-100 group-data-[state=open]/activity:rotate-90 group-data-[state=open]/activity:opacity-100" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="ms-2 mt-1 flex max-h-72 flex-col gap-1 overflow-y-auto border-s ps-3.5 pb-1">
          {calls.map((call) => (
            <li key={call.id} className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <ToolStatusIcon call={call} />
              <span className="truncate">{call.body.title}</span>
              {call.body.error ? <span className="truncate text-destructive">{call.body.error.message}</span> : null}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
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
      const seconds = (Date.now() - since.getTime()) / 1000;
      // Nothing under a second: "for 0s" reads as a glitch.
      element.textContent = seconds < 1 ? '' : `for ${formatElapsed(seconds)}`;
    };
    write();
    const timer = setInterval(write, 1000);
    return () => clearInterval(timer);
  };
}

/** The live line while the assistant works and nothing is streaming yet. */
export function AssistantLiveStatus({ label, since }: { label: string; since: Date }) {
  return (
    <div className="flex min-h-6 items-center gap-1.5 px-1 text-sm/relaxed text-muted-foreground" role="status">
      <Sparkles className="size-4 shrink-0" aria-hidden />
      <span className="assistant-shimmer">{label}</span>
      <span className="tabular-nums" ref={tickElapsed(since)} />
    </div>
  );
}

const NOTICE_TEXT: Record<'failed' | 'cancelled', string> = {
  failed: 'The assistant stopped with an error.',
  cancelled: 'Stopped.',
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
      {status === 'failed' ? <AlertCircle className="size-4 shrink-0" aria-hidden /> : <CircleSlash className="size-4 shrink-0" aria-hidden />}
      <span>{run.errorMessage ?? NOTICE_TEXT[status]}</span>
      {action}
    </div>
  );
}
