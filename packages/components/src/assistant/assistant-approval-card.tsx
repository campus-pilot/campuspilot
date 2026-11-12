import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@campuspilot/ui/components/collapsible';
import { Kbd } from '@campuspilot/ui/components/kbd';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { cn } from '@campuspilot/ui/lib/utils';
import { AlertCircle, Check, ChevronDown, CircleSlash, CornerDownLeft, Shield, ShieldQuestionMark, SquarePen, X } from 'lucide-react';
import { useRef, useSyncExternalStore } from 'react';

import { APPROVE_BUTTON_ATTRIBUTE, approvalFocus, decisionKeys, type AssistantApprovalDecision } from './approval-keys';
import type { ApprovalSummary } from './approval-summaries';
import { approvalValueDisplay, humanizeKey, type ApprovalValueDisplay } from './approval-values';

export { ASSISTANT_SURFACE_PROPS, type AssistantApprovalDecision } from './approval-keys';

/**
 * Input keys not shown on the card. `schoolId` is always the conversation's
 * own school (the API enforces it), so showing it adds noise, not information.
 */
const HIDDEN_INPUT_KEYS = new Set(['schoolId']);

/**
 * Keys that name which record changes rather than what changes (`classId`).
 * They stay visible, as a quiet reference, so the change reads first.
 */
const isReference = (key: string) => /Ids?$/.test(key);

type ChangeField = Extract<ApprovalValueDisplay, { kind: 'fields' }>['fields'][number];

/**
 * What the change will set, as labelled values in the reader's words (never raw JSON).
 * A key the tool's summary has a note for shows that note instead of its value.
 */
function changeFields(input: unknown, notes: Readonly<Record<string, string>> = {}): ChangeField[] {
  if (typeof input !== 'object' || input === null) return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([key]) => !HIDDEN_INPUT_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      label: humanizeKey(key),
      value: key in notes ? ({ kind: 'text', text: notes[key]! } satisfies ApprovalValueDisplay) : approvalValueDisplay(value),
    }));
}

/**
 * Labelled values of a change. A value that is itself a record renders as
 * the same list one level in (`nested`), behind a hairline, so its fields
 * read as belonging to their label.
 */
function ChangeFields({ fields, nested = false }: { fields: readonly ChangeField[]; nested?: boolean }) {
  return (
    <dl className={cn('grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1', nested && 'border-s border-assistant-hairline ps-3')}>
      {fields.map((field) => (
        <div key={field.key} className="contents">
          <dt className="font-normal text-muted-foreground">{field.label}</dt>
          <dd
            className={cn(
              'min-w-0 break-words',
              field.value.kind === 'text' && isReference(field.key)
                ? 'font-mono text-[11px]/5 text-assistant-dim'
                : 'font-medium text-foreground',
            )}
          >
            {field.value.kind === 'text' ? field.value.text : <ChangeFields fields={field.value.fields} nested />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The change as a tool's own sentence, with the values behind it in a
 * collapsed "Details" disclosure. Fields the summary does not move to Details
 * stay visible under the sentence.
 */
function SummarizedChange({ summary, fields }: { summary: ApprovalSummary; fields: readonly ChangeField[] }) {
  const shown = fields.filter((field) => !summary.detailKeys.has(field.key) && !(field.key in summary.notes));
  const details = fields.filter((field) => summary.detailKeys.has(field.key) || field.key in summary.notes);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="font-medium break-words text-foreground">{summary.sentence}</p>
      {shown.length ? <ChangeFields fields={shown} /> : null}
      {details.length ? (
        <Collapsible className="flex min-w-0 flex-col gap-1">
          <CollapsibleTrigger className="flex items-center gap-1 self-start text-muted-foreground">
            Details
            <ChevronDown className="size-3" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ChangeFields fields={details} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

/**
 * Whether Enter would approve right now, which depends on where focus is
 * (see `approvalFocus`). Read with `useSyncExternalStore` over the
 * document's focus events, so it follows focus without an effect. `hold`
 * receives the request's element; the answer is false until it is known.
 */
function useEnterApproves() {
  const request = useRef<HTMLElement | null>(null);
  const approves = useSyncExternalStore(
    approvalFocus.subscribe,
    () => approvalFocus.enterApproves(request.current),
    () => false,
  );
  return { approves, request };
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

/**
 * The decision, as the top section of the composer, above the message box
 * (T3 Code's request card): what will change, in an inset well, then Decline and
 * Approve. One change at a time; a counter says how many wait.
 */
export function AssistantApprovalRequest({
  call,
  waiting,
  pendingDecision,
  error,
  summary,
  onDecide,
}: {
  call: AssistantToolCallItemDto;
  /** How many changes wait, including this one. */
  waiting: number;
  /**
   * The decision already made: set from the moment it is sent until the
   * request leaves the tray, so it cannot be sent twice in between.
   */
  pendingDecision?: AssistantApprovalDecision;
  /** Why the last decision could not be sent; shown in place of the hint. */
  error?: string | null;
  /** The tool's own sentence for this change (`approvalSummaryOf`), when it has one: replaces the list of ids and values. */
  summary?: ApprovalSummary | null;
  onDecide: (decision: AssistantApprovalDecision) => void;
}) {
  const fields = changeFields(call.body.input, summary?.notes);
  const busy = Boolean(pendingDecision);
  const enter = useEnterApproves();
  return (
    <section
      // Holds the element for the Enter hint and listens for the decision keys, for as long as the request shows.
      ref={(element) => {
        enter.request.current = element;
        const stopListening = decisionKeys(onDecide, !busy)(element);
        return () => {
          enter.request.current = null;
          stopListening?.();
        };
      }}
      aria-label={`Approve ${call.body.title}`}
      // Focusable without a tab stop, so a click on the request puts focus in it (Escape then declines).
      tabIndex={-1}
      className="flex min-w-0 flex-col gap-1 p-1 text-xs outline-none"
    >
      <header className="flex min-h-8 min-w-0 items-center gap-2 px-2.5">
        <ShieldQuestionMark className="size-[13px] shrink-0 text-assistant-warning" aria-hidden />
        <h3 className="shrink-0 text-sm font-medium text-foreground">Approval needed</h3>
        <span className="min-w-0 flex-1 truncate text-assistant-dim">{call.body.title}</span>
        {waiting > 1 ? <span className="shrink-0 text-assistant-dim tabular-nums">1 of {waiting}</span> : null}
      </header>
      {fields.length ? (
        <div className="px-1.5">
          <div className="max-h-60 overflow-y-auto rounded-lg bg-muted/60 px-3 py-2.5 text-xs/relaxed dark:bg-muted/40">
            {summary ? <SummarizedChange summary={summary} fields={fields} /> : <ChangeFields fields={fields} />}
          </div>
        </div>
      ) : null}
      <footer className="flex min-w-0 flex-wrap items-center justify-end gap-2 py-1.5 ps-2.5 pe-1.5">
        {error ? (
          <p role="alert" className="min-w-0 flex-1 text-destructive">
            {error}
          </p>
        ) : (
          <p className="min-w-0 flex-1 truncate text-assistant-dim">
            {call.body.destructive ? 'This changes existing data.' : 'Nothing changes until you approve.'}
          </p>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onDecide('decline')}>
            {pendingDecision === 'decline' ? <Spinner /> : null}
            Decline
          </Button>
          <Button type="button" disabled={busy} onClick={() => onDecide('approve')} {...{ [APPROVE_BUTTON_ATTRIBUTE]: '' }}>
            {pendingDecision === 'approve' ? <Spinner /> : null}
            Approve
            {/* Only while Enter would approve: with focus in the message box it sends the message instead. */}
            {enter.approves && !busy ? (
              <Kbd className="-me-0.5 h-4 min-w-4 bg-black/10 text-current dark:bg-white/15">
                <CornerDownLeft className="size-2.5" aria-hidden />
              </Kbd>
            ) : null}
          </Button>
        </div>
      </footer>
    </section>
  );
}
