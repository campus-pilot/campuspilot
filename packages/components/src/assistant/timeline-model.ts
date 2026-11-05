import type {
  AssistantItemDto,
  AssistantRunDto,
  AssistantToolCallItemDto,
  AssistantUserMessageItemDto,
  AssistantViewItemDto,
} from '@campuspilot/assistant-contract/dto';

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
  /** The live line while the model thinks and nothing else shows progress. */
  | { kind: 'live'; id: string; label: 'Thinking' }
  | { kind: 'notice'; id: string; run: AssistantRunDto };

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
    } else {
      activity.push(item);
    }
  }
  flush();
  return rows;
}

function turnRows(run: AssistantRunDto | undefined, items: readonly AssistantItemDto[]): AssistantTimelineRow[] {
  const rows = contentRows(items);
  const users = rows.filter((row) => row.kind === 'user');
  const content = rows.filter((row) => row.kind !== 'user');
  const state = run ? WORK_STATE[run.status] : null;
  // Runs with no known status (should not happen) show their rows plainly.
  if (!run || !state) return rows;

  const calls = items.filter((item): item is AssistantToolCallItemDto => item.kind === 'tool_call');
  const pending = calls.find((call) => call.status === 'awaiting_approval') ?? null;
  const notice: AssistantTimelineRow[] =
    run.status === 'failed' || run.status === 'cancelled' ? [{ kind: 'notice', id: `notice:${run.id}`, run }] : [];

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

export function buildAssistantTimeline(
  items: readonly AssistantItemDto[],
  runs: readonly AssistantRunDto[],
): AssistantTimelineRow[] {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const rows: AssistantTimelineRow[] = [];
  for (const [runId, runItems] of itemsByRun(items)) {
    // Queued messages wait in the composer tray, not the timeline.
    if (runById.get(runId)?.status === 'queued') continue;
    rows.push(...turnRows(runById.get(runId), runItems));
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

/** Messages waiting behind the run that is working, oldest first. */
export function queuedMessages(
  items: readonly AssistantItemDto[],
  runs: readonly AssistantRunDto[],
): AssistantUserMessageItemDto[] {
  const queued = new Set(runs.filter((run) => run.status === 'queued').map((run) => run.id));
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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

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
