import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { AlertCircle, Check, ShieldQuestion, X } from 'lucide-react';

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
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function ApprovalInput({ input }: { input: unknown }) {
  const entries =
    typeof input === 'object' && input !== null
      ? Object.entries(input as Record<string, unknown>).filter(([key]) => !HIDDEN_INPUT_KEYS.has(key))
      : [];
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{humanizeKey(key)}</dt>
          <dd className="min-w-0 break-words">{displayValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

const OUTCOME: Partial<Record<AssistantToolCallItemDto['status'], { label: string; icon: typeof Check }>> = {
  running: { label: 'Approved, running…', icon: Check },
  succeeded: { label: 'Approved and done', icon: Check },
  failed: { label: 'Approved, but it failed', icon: AlertCircle },
  declined: { label: 'Declined', icon: X },
  cancelled: { label: 'Cancelled', icon: X },
};

function ApprovalOutcome({ call }: { call: AssistantToolCallItemDto }) {
  const outcome = OUTCOME[call.status];
  if (!outcome) return null;
  const Icon = outcome.icon;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {outcome.label}
      {call.body.error ? <span className="text-destructive">: {call.body.error.message}</span> : null}
    </p>
  );
}

/**
 * A change the assistant wants to make. While it waits, the user approves or
 * declines it here; afterwards the card records what happened.
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
  const waiting = call.status === 'awaiting_approval';
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3" aria-label={`Approve: ${call.body.title}`}>
      <header className="flex items-center gap-2">
        <ShieldQuestion className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-xs font-medium">{call.body.title}</h3>
        <Badge variant={call.body.destructive ? 'destructive' : 'outline'} className="ml-auto">
          {call.body.destructive ? 'Changes existing data' : 'Adds data'}
        </Badge>
      </header>
      <ApprovalInput input={call.body.input} />
      {waiting ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={Boolean(pendingDecision)} onClick={() => onDecide('decline')}>
            {pendingDecision === 'decline' ? <Spinner /> : null}
            Decline
          </Button>
          <Button type="button" disabled={Boolean(pendingDecision)} onClick={() => onDecide('approve')}>
            {pendingDecision === 'approve' ? <Spinner /> : null}
            Approve
          </Button>
        </div>
      ) : (
        <ApprovalOutcome call={call} />
      )}
    </section>
  );
}
