import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { cn } from '@campuspilot/ui/lib/utils';
import { AlertCircle, Check, CircleSlash, ShieldQuestion, X } from 'lucide-react';

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

function ChangeList({ input }: { input: unknown }) {
  const entries =
    typeof input === 'object' && input !== null
      ? Object.entries(input as Record<string, unknown>).filter(([key]) => !HIDDEN_INPUT_KEYS.has(key))
      : [];
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs/relaxed">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{humanizeKey(key)}</dt>
          <dd className="min-w-0 break-words font-medium text-foreground">{displayValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

const OUTCOME: Partial<Record<AssistantToolCallItemDto['status'], { label: string; icon: typeof Check; tone?: string }>> = {
  running: { label: 'Approved', icon: Check },
  succeeded: { label: 'Approved', icon: Check },
  failed: { label: 'Approved, but it failed', icon: AlertCircle, tone: 'text-destructive' },
  declined: { label: 'Declined', icon: X },
  cancelled: { label: 'Cancelled', icon: CircleSlash },
};

/** After the decision, the card folds to one quiet line in the history. */
function DecidedChange({ call }: { call: AssistantToolCallItemDto }) {
  const outcome = OUTCOME[call.status];
  if (!outcome) return null;
  const Icon = outcome.icon;
  return (
    <div className={cn('flex min-h-6 min-w-0 items-center gap-1.5 px-1 text-sm/relaxed text-muted-foreground', outcome.tone)}>
      {call.status === 'running' ? <Spinner className="size-3.5" /> : <Icon className="size-4 shrink-0" aria-hidden />}
      <span className="shrink-0">{outcome.label}</span>
      <span className="truncate text-foreground/80">{call.body.title}</span>
      {call.body.error ? <span className="truncate">· {call.body.error.message}</span> : null}
    </div>
  );
}

/**
 * A change the assistant wants to make. While it waits the user approves or
 * declines it here; afterwards it records what happened in one line.
 */
export function AssistantApprovalCard({
  call,
  pendingDecision,
  onDecide,
}: {
  call: AssistantToolCallItemDto;
  /** The decision being sent, while it is in flight. */
  pendingDecision?: AssistantApprovalDecision;
  onDecide: (decision: AssistantApprovalDecision) => void;
}) {
  if (call.status !== 'awaiting_approval') return <DecidedChange call={call} />;
  return (
    <section
      aria-label={`Approve: ${call.body.title}`}
      className="relative flex flex-col gap-3 rounded-xl bg-card p-3.5 shadow-composer after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-surface-outline"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{call.body.title}</h3>
        {call.body.destructive ? (
          <span className="shrink-0 text-xs text-muted-foreground">Changes existing data</span>
        ) : null}
      </header>
      <ChangeList input={call.body.input} />
      <footer className="flex items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <ShieldQuestion className="size-3.5 shrink-0" aria-hidden />
          Waiting for your approval
        </p>
        <Button type="button" variant="ghost" size="sm" disabled={Boolean(pendingDecision)} onClick={() => onDecide('decline')}>
          {pendingDecision === 'decline' ? <Spinner /> : null}
          Decline
        </Button>
        <Button type="button" size="sm" disabled={Boolean(pendingDecision)} onClick={() => onDecide('approve')}>
          {pendingDecision === 'approve' ? <Spinner /> : null}
          Approve
        </Button>
      </footer>
    </section>
  );
}
