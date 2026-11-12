import type {
  AssistantItemDto,
  AssistantRunDto,
  AssistantToolCallItemDto,
  AssistantUserMessageItemDto,
  AssistantViewItemDto,
} from '@campuspilot/assistant-contract/dto';

import { assistantCardOf, type AssistantCardKind } from '@campuspilot/assistant-contract/protocol';

import { plural } from './plural';

/**
 * Where a turn stands, as its work bar says it: "Working for 12s",
 * "Paused at 8s" (waiting on the user, so the clock stops), "Worked for 18s",
 * "Failed after 4s", "Stopped at 6s".
 */
export type AssistantWorkState = 'working' | 'paused' | 'done' | 'failed' | 'stopped';

/**
 * Rows of an assistant conversation. Built from item and run structure only:
 * streamed text is deliberately not an input, so a text frame never rebuilds
 * the rows and only the streaming message re-renders (after T3 Code).
 */
export type AssistantTimelineRow =
  | { kind: 'user'; id: string; item: AssistantUserMessageItemDto }
  /**
   * A turn's work bar, a 32px line over a hairline. Once the turn ends, its
   * work (tool calls, decided approvals, interim replies) folds into the bar
   * (`folded`); the views and the final answer stay visible under it.
   */
  | {
      kind: 'work';
      id: string;
      runId: string;
      state: AssistantWorkState;
      /** When the clock started; null if the run never started. */
      since: Date | null;
      /** When the clock stopped: the end, or the moment it paused for the user. */
      until: Date | null;
      folded: AssistantTimelineRow[];
      /** The change waiting for the user, while paused. */
      pending: AssistantToolCallItemDto | null;
      /** Writes that went through, for the bar's right side. */
      changes: number;
      /** The user asked this turn to stop and it has not ended yet ("Stopping…"). */
      stopRequested: boolean;
      /** Developer diagnostics of the run; null unless the service sends them. */
      diagnostics: AssistantRunDto['diagnostics'];
    }
  /** `meta`: time and copy under it; only the final answer of a finished turn has them. */
  | { kind: 'reply'; id: string; itemId: string; meta: boolean }
  /** Consecutive tool calls that need no decision, summarised as one line. */
  | { kind: 'activity'; id: string; calls: AssistantToolCallItemDto[] }
  /** A write that waited for, or still waits for, the user's decision. */
  | { kind: 'approval'; id: string; call: AssistantToolCallItemDto }
  /** Platform UI the assistant showed. */
  | { kind: 'view'; id: string; item: AssistantViewItemDto }
  /**
   * A tool call the chat shows as a card of its own (a question paper draft),
   * never folded under the work bar like other tool calls. Only a call that
   * succeeded becomes a card.
   */
  | { kind: 'card'; id: string; card: AssistantCardKind; call: AssistantToolCallItemDto }
  /** The live line while the model thinks and nothing else shows progress. */
  | { kind: 'live'; id: string; label: 'Thinking' }
  /**
   * Why a turn ended early. `retryText` is the question to ask again, set
   * only on the conversation's latest turn while nothing is working or
   * waiting; it is what "Try again" sends.
   */
  | { kind: 'notice'; id: string; run: AssistantRunDto; retryText: string | null };

/** Whether a tool call is shown as a decision rather than activity. */
export function isDecisionCall(call: AssistantToolCallItemDto): boolean {
  return call.body.approvalId !== undefined || call.status === 'awaiting_approval';
}

const WORK_STATE: Record<AssistantRunDto['status'], AssistantWorkState | null> = {
  queued: null,
  running: 'working',
  awaiting_approval: 'paused',
  completed: 'done',
  failed: 'failed',
  cancelled: 'stopped',
};

/** Rows folded under a finished turn's bar; everything else stays visible. */
const FOLDS: ReadonlySet<AssistantTimelineRow['kind']> = new Set(['activity', 'approval', 'reply']);

/**
 * Items grouped per run, runs in the order they were asked. A message sent
 * while another run works is stored mid-way through that run's items; it is
 * shown after that run, where its own answer will be.
 */
function itemsByRun(items: readonly AssistantItemDto[]): Map<string, AssistantItemDto[]> {
  const byRun = new Map<string, AssistantItemDto[]>();
  for (const item of items) {
    const list = byRun.get(item.runId);
    if (list) list.push(item);
    else byRun.set(item.runId, [item]);
  }
  return byRun;
}

/** One run's own rows, in order: users, replies, activity groups, approvals, views. */
function contentRows(items: readonly AssistantItemDto[]): AssistantTimelineRow[] {
  const rows: AssistantTimelineRow[] = [];
  let activity: AssistantToolCallItemDto[] = [];
  const flush = () => {
    if (activity.length === 0) return;
    rows.push({ kind: 'activity', id: `activity:${activity[0]!.id}`, calls: activity });
    activity = [];
  };
  for (const item of items) {
    if (item.kind === 'user_message') {
      flush();
      rows.push({ kind: 'user', id: item.id, item });
    } else if (item.kind === 'assistant_message') {
      if (item.status === 'complete' && !item.body.text.trim()) continue;
      flush();
      rows.push({ kind: 'reply', id: item.id, itemId: item.id, meta: false });
    } else if (item.kind === 'view') {
      flush();
      rows.push({ kind: 'view', id: item.id, item });
    } else if (isDecisionCall(item)) {
      flush();
      rows.push({ kind: 'approval', id: item.id, call: item });
    } else if (item.status === 'succeeded' && assistantCardOf(item.body.toolName)) {
      flush();
      rows.push({ kind: 'card', id: item.id, card: assistantCardOf(item.body.toolName)!, call: item });
    } else {
      activity.push(item);
    }
  }
  flush();
  return rows;
}

/** The text of a turn's last question, which is what trying it again sends. */
/** The text of the newest message the user sent among `items`, or null. */
export function lastUserText(items: readonly AssistantItemDto[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.kind === 'user_message') return item.body.text;
  }
  return null;
}

function turnRows(
  run: AssistantRunDto | undefined,
  items: readonly AssistantItemDto[],
  /** Whether this turn may offer "Try again" (see `retryableRunId`). */
  retryable: boolean,
): AssistantTimelineRow[] {
  const rows = contentRows(items);
  const users = rows.filter((row) => row.kind === 'user');
  const content = rows.filter((row) => row.kind !== 'user');
  const state = run ? WORK_STATE[run.status] : null;
  // Runs with no known status (should not happen) show their rows plainly.
  if (!run || !state) return rows;

  const calls = items.filter((item): item is AssistantToolCallItemDto => item.kind === 'tool_call');
  const pending = calls.find((call) => call.status === 'awaiting_approval') ?? null;
  const notice: AssistantTimelineRow[] =
    run.status === 'failed' || run.status === 'cancelled'
      ? [{ kind: 'notice', id: `notice:${run.id}`, run, retryText: retryable ? lastUserText(items) : null }]
      : [];

  // A run stopped before it began has nothing to time; only say it stopped.
  if (!run.startedAt && content.length === 0) return [...users, ...notice];

  const bar = {
    kind: 'work' as const,
    id: `work:${run.id}`,
    runId: run.id,
    state,
    since: run.startedAt,
    until: state === 'paused' ? (pending?.createdAt ?? null) : run.completedAt,
    pending: state === 'paused' ? pending : null,
    changes: calls.filter((call) => call.body.access === 'write' && call.status === 'succeeded').length,
    diagnostics: run.diagnostics,
    stopRequested: (state === 'working' || state === 'paused') && run.stopRequestedAt !== null,
  };

  if (state === 'working' || state === 'paused') {
    return [...users, { ...bar, folded: [] }, ...content, ...liveRows(run, items)];
  }

  const finalReply = [...content].reverse().find((row) => row.kind === 'reply');
  const folded = content.filter((row) => FOLDS.has(row.kind) && row !== finalReply);
  const visible = content
    .filter((row) => !folded.includes(row))
    .map((row) => (row === finalReply && row.kind === 'reply' ? { ...row, meta: true } : row));
  return [...users, { ...bar, folded }, ...visible, ...notice];
}

/**
 * The turn that may offer "Try again": the conversation's newest one, when
 * it failed or was stopped and nothing is working, waiting for approval or
 * queued. Older failed turns never offer it (the conversation has moved on),
 * and neither does anything while a turn is in progress, so a retry cannot
 * pile onto work that is still running. A queued message the user removed
 * (cancelled before it ever started) offers nothing: they took it back on
 * purpose.
 */
function retryableRunId(runs: readonly AssistantRunDto[]): string | null {
  if (activeRun(runs)) return null;
  const newest = runs.reduce<AssistantRunDto | null>(
    (latest, run) => (!latest || run.createdAt.getTime() >= latest.createdAt.getTime() ? run : latest),
    null,
  );
  if (!newest) return null;
  const removedBeforeStart = newest.status === 'cancelled' && !newest.startedAt;
  return (newest.status === 'failed' || newest.status === 'cancelled') && !removedBeforeStart ? newest.id : null;
}

export function buildAssistantTimeline(
  items: readonly AssistantItemDto[],
  runs: readonly AssistantRunDto[],
): AssistantTimelineRow[] {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const retryable = retryableRunId(runs);
  const rows: AssistantTimelineRow[] = [];
  for (const [runId, runItems] of itemsByRun(items)) {
    // Queued messages wait in the composer tray, not the timeline.
    if (runById.get(runId)?.status === 'queued') continue;
    rows.push(...turnRows(runById.get(runId), runItems, runId === retryable));
  }
  return rows;
}

/**
 * The live "Thinking" line: shown while the model works and nothing else is
 * visibly progressing, so not while a reply streams (the text is the
 * progress), a tool runs (its row shimmers) or an approval waits (the tray
 * holds the next step).
 */
function liveRows(run: AssistantRunDto, items: readonly AssistantItemDto[]): AssistantTimelineRow[] {
  if (run.status !== 'running') return [];
  const last = items.at(-1);
  if (last?.kind === 'assistant_message' && last.status === 'streaming') return [];
  if (items.some((item) => item.kind === 'tool_call' && (item.status === 'running' || item.status === 'awaiting_approval'))) {
    return [];
  }
  return [{ kind: 'live', id: `live:${run.id}`, label: 'Thinking' }];
}

/**
 * Messages waiting behind the run that is working, oldest first. A queued
 * message the user removed (its run has a stop request) is left out at
 * once: the service ends that run as stopped the moment its turn comes,
 * before anything is sent to the model, so it will never be answered.
 */
export function queuedMessages(
  items: readonly AssistantItemDto[],
  runs: readonly AssistantRunDto[],
): AssistantUserMessageItemDto[] {
  const queued = new Set(
    runs.filter((run) => run.status === 'queued' && run.stopRequestedAt === null).map((run) => run.id),
  );
  return items.filter(
    (item): item is AssistantUserMessageItemDto => item.kind === 'user_message' && queued.has(item.runId),
  );
}

/** Changes waiting for the user's decision, oldest first. */
export function pendingApprovals(items: readonly AssistantItemDto[]): AssistantToolCallItemDto[] {
  return items.filter(
    (item): item is AssistantToolCallItemDto => item.kind === 'tool_call' && item.status === 'awaiting_approval',
  );
}

/**
 * One-line summary of an activity group: the running call's title, or what
 * was done, joined with "and" (T3 Code's group summaries, no middle dots).
 */
export function summarizeActivity(calls: readonly AssistantToolCallItemDto[]): string {
  const running = calls.find((call) => call.status === 'running');
  if (running) return running.body.title;
  const reads = calls.filter((call) => call.body.access === 'read').length;
  const writes = calls.length - reads;
  const failed = calls.filter((call) => call.status === 'failed').length;
  const parts = [
    reads ? `Looked up ${plural(reads, 'record', 'records')}` : null,
    writes ? `updated ${plural(writes, 'record', 'records')}` : null,
    failed ? `${failed} failed` : null,
  ].filter((part): part is string => Boolean(part));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * What a screen reader should be told about the conversation right now, as
 * the text of one polite live region; it speaks when this text changes.
 *
 * - A change waiting for a decision is named, since it needs the user.
 * - Otherwise the finished answer of the latest turn is read, once: nothing
 *   is said while the turn works (no streamed frames), and answers that were
 *   already there when the conversation was opened (`openedSequence`) are
 *   not read out again.
 */
export function assistantAnnouncement(
  items: readonly AssistantItemDto[],
  runs: readonly AssistantRunDto[],
  openedSequence: number,
): string {
  const waiting = pendingApprovals(items)[0];
  if (waiting) return `Approval needed: ${waiting.body.title}`;
  const latest = [...runs].reverse().find((run) => run.status !== 'queued');
  if (latest?.status !== 'completed') return '';
  const answer = [...items]
    .reverse()
    .find((item) => item.runId === latest.id && item.kind === 'assistant_message' && item.status === 'complete');
  if (answer?.kind !== 'assistant_message' || answer.sequence <= openedSequence) return '';
  const text = answer.body.text.trim();
  return text ? `Assistant replied: ${text}` : '';
}

/** The run still doing work, if any: the one to stop. */
export function activeRun(runs: readonly AssistantRunDto[]): AssistantRunDto | null {
  return (
    [...runs]
      .reverse()
      .find((run) => run.status === 'running' || run.status === 'awaiting_approval') ??
    [...runs].reverse().find((run) => run.status === 'queued') ??
    null
  );
}
