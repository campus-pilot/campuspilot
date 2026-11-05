import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { Kbd } from '@campuspilot/ui/components/kbd';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { cn } from '@campuspilot/ui/lib/utils';
import { AlertCircle, Check, CircleSlash, CornerDownLeft, Shield, ShieldQuestionMark, SquarePen, X } from 'lucide-react';

export type AssistantApprovalDecision = 'approve' | 'decline';

/**
 * Input keys not shown on the card. `schoolId` is always the conversation's
 * own school (the API enforces it), so showing it adds noise, not information.
 */
const HIDDEN_INPUT_KEYS = new Set(['schoolId']);

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (first) => first.toUpperCase());
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Keys that name which record changes rather than what changes (`classId`).
 * They stay visible, as a quiet reference, so the change reads first.
 */
const isReference = (key: string) => /Ids?$/.test(key);

function changeEntries(input: unknown): [string, unknown][] {
  return typeof input === 'object' && input !== null
    ? Object.entries(input as Record<string, unknown>).filter(([key]) => !HIDDEN_INPUT_KEYS.has(key))
    : [];
}

const OUTCOME: Partial<Record<AssistantToolCallItemDto['status'], { label: string; icon: typeof Check; tone?: string }>> = {
  running: { label: 'Approved', icon: Check },
  succeeded: { label: 'Approved', icon: Check },
  failed: { label: 'Approved, but it failed', icon: AlertCircle, tone: 'text-destructive' },
  declined: { label: 'Declined', icon: X },
  cancelled: { label: 'Cancelled', icon: CircleSlash },
};

/**
 * A change on its timeline row. While it waits, the row names it and says
 * so in amber; the decision itself is made in the composer tray. Afterwards
 * it records what happened in one line.
 */
export function AssistantApprovalCard({ call }: { call: AssistantToolCallItemDto }) {
  if (call.status === 'awaiting_approval') {
    return (
      <div className="flex flex-col px-0.5">
        <span className="flex min-h-6 min-w-0 items-center gap-1.5 text-[13px] text-foreground">
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
            <SquarePen className="size-3.5" aria-hidden />
          </span>
          <span className="truncate">{call.body.title}</span>
        </span>
        <span className="ms-6.5 flex items-center gap-1 text-xs text-assistant-warning">
          <Shield className="size-3" aria-hidden />
          Waiting for approval
        </span>
      </div>
    );
  }
  const outcome = OUTCOME[call.status];
  if (!outcome) return null;
  const Icon = outcome.icon;
  return (
    <div className={cn('flex min-h-6 min-w-0 items-center gap-1.5 px-0.5 text-[13px] text-muted-foreground', outcome.tone)}>
      <span className="flex size-5 shrink-0 items-center justify-center">
        {call.status === 'running' ? <Spinner className="size-3.5" /> : <Icon className="size-3.5" aria-hidden />}
      </span>
      <span className="shrink-0">{outcome.label}</span>
      <span className="truncate text-foreground/80">{call.body.title}</span>
      {call.body.error ? <span className="truncate">{call.body.error.message}</span> : null}
    </div>
  );
}

/** Targets that keep their own Enter and Escape (T3 Code's approval keys). */
const OWNS_KEYS =
  'input, textarea, select, button, a[href], [role=button], [role=link], summary, [contenteditable]:not([contenteditable=false]), [role=dialog], [role=menu], [role=listbox]';

/**
 * Enter approves and Escape declines, but only when nothing that uses those
 * keys has focus: typing in the message box, a menu or a dialog keeps its
 * own keys. Attached through a ref callback so it lives exactly as long as
 * the card does.
 */
function decisionKeys(onDecide: (decision: AssistantApprovalDecision) => void, enabled: boolean) {
  return (element: HTMLElement | null) => {
    if (!element || !enabled) return;
    const document = element.ownerDocument;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(OWNS_KEYS)) return;
      event.preventDefault();
      onDecide(event.key === 'Enter' ? 'approve' : 'decline');
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  };
}

/**
 * The decision, in the composer tray above the message box (T3 Code's
 * request card): what will change, in an inset well, then Decline and
 * Approve. One change at a time; a counter says how many wait.
 */
export function AssistantApprovalRequest({
  call,
  waiting,
  pendingDecision,
  onDecide,
}: {
  call: AssistantToolCallItemDto;
  /** How many changes wait, including this one. */
  waiting: number;
  /** The decision being sent, while it is in flight. */
  pendingDecision?: AssistantApprovalDecision;
  onDecide: (decision: AssistantApprovalDecision) => void;
}) {
  const entries = changeEntries(call.body.input);
  const busy = Boolean(pendingDecision);
  return (
    <section
      ref={decisionKeys(onDecide, !busy)}
      aria-label={`Approve ${call.body.title}`}
      className="flex min-w-0 flex-col gap-1 p-1 text-xs"
    >
      <header className="flex min-h-8 min-w-0 items-center gap-2 px-2.5">
        <ShieldQuestionMark className="size-[13px] shrink-0 text-assistant-warning" aria-hidden />
        <h3 className="shrink-0 text-sm font-medium text-foreground">Approval needed</h3>
        <span className="min-w-0 flex-1 truncate text-assistant-dim">{call.body.title}</span>
        {waiting > 1 ? <span className="shrink-0 text-assistant-dim tabular-nums">1 of {waiting}</span> : null}
      </header>
      {entries.length ? (
        <div className="px-1.5">
          <dl className="grid max-h-40 grid-cols-[max-content_1fr] gap-x-4 gap-y-1 overflow-y-auto rounded-lg assistant-well px-3 py-2.5 text-xs/relaxed">
            {entries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{humanizeKey(key)}</dt>
                <dd
                  className={cn(
                    'min-w-0 break-words',
                    isReference(key) ? 'font-mono text-[11px]/5 text-assistant-dim' : 'font-medium text-foreground',
                  )}
                >
                  {displayValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <footer className="flex min-w-0 flex-wrap items-center justify-end gap-2 py-1.5 ps-2.5 pe-1.5">
        <p className="min-w-0 flex-1 truncate text-assistant-dim">
          {call.body.destructive ? 'This changes existing data.' : 'Nothing changes until you approve.'}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onDecide('decline')}>
            {pendingDecision === 'decline' ? <Spinner /> : null}
            Decline
          </Button>
          <Button type="button" disabled={busy} onClick={() => onDecide('approve')}>
            {pendingDecision === 'approve' ? <Spinner /> : null}
            Approve
            <Kbd className="-me-0.5 h-4 min-w-4 bg-black/10 text-current dark:bg-white/15">
              <CornerDownLeft className="size-2.5" aria-hidden />
            </Kbd>
          </Button>
        </div>
      </footer>
    </section>
  );
}
