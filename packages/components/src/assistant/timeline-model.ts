import type {
  AssistantItemDto,
  AssistantRunDto,
  AssistantToolCallItemDto,
  AssistantUserMessageItemDto,
} from '@campuspilot/assistant-contract/dto';

/**
 * Rows of an assistant conversation. Built from item and run structure only:
 * streamed text is deliberately not an input, so a text frame never rebuilds
 * the rows and only the streaming message re-renders (after T3 Code).
 */
export type AssistantTimelineRow =
  | { kind: 'user'; id: string; item: AssistantUserMessageItemDto }
  | { kind: 'reply'; id: string; itemId: string }
  /** Consecutive tool calls that need no decision, summarised as one line. */
  | { kind: 'activity'; id: string; calls: AssistantToolCallItemDto[] }
  /** A write that waited for, or still waits for, the user's decision. */
  | { kind: 'approval'; id: string; call: AssistantToolCallItemDto }
  | { kind: 'notice'; id: string; run: AssistantRunDto };

/** Whether a tool call is shown as a decision card rather than activity. */
export function isDecisionCall(call: AssistantToolCallItemDto): boolean {
  return call.body.approvalId !== undefined || call.status === 'awaiting_approval';
}

export function buildAssistantTimeline(
  items: readonly AssistantItemDto[],
  runs: readonly AssistantRunDto[],
): AssistantTimelineRow[] {
  const rows: AssistantTimelineRow[] = [];
  const noticeRuns = new Map(
    runs
      .filter((run) => run.status === 'failed' || run.status === 'cancelled')
      .map((run) => [run.id, run]),
  );
  let activity: AssistantToolCallItemDto[] = [];
  let currentRunId: string | null = null;

  const flushActivity = () => {
    if (activity.length === 0) return;
    rows.push({ kind: 'activity', id: `activity:${activity[0]!.id}`, calls: activity });
    activity = [];
  };
  const closeRun = (runId: string | null) => {
    const run = runId ? noticeRuns.get(runId) : undefined;
    if (run) rows.push({ kind: 'notice', id: `notice:${run.id}`, run });
  };

  for (const item of items) {
    if (item.runId !== currentRunId) {
      flushActivity();
      closeRun(currentRunId);
      currentRunId = item.runId;
    }
    if (item.kind === 'user_message') {
      rows.push({ kind: 'user', id: item.id, item });
    } else if (item.kind === 'assistant_message') {
      if (item.status === 'complete' && !item.body.text.trim()) continue;
      flushActivity();
      rows.push({ kind: 'reply', id: item.id, itemId: item.id });
    } else if (isDecisionCall(item)) {
      flushActivity();
      rows.push({ kind: 'approval', id: item.id, call: item });
    } else {
      activity.push(item);
    }
  }
  flushActivity();
  closeRun(currentRunId);
  return rows;
}

const VERB_BY_ACCESS = { read: 'Looked up', write: 'Updated' } as const;

/** One-line summary of an activity group, e.g. "Looked up 3 records · 1 failed". */
export function summarizeActivity(calls: readonly AssistantToolCallItemDto[]): string {
  const running = calls.find((call) => call.status === 'running');
  if (running) return `${running.body.title}…`;
  const reads = calls.filter((call) => call.body.access === 'read').length;
  const writes = calls.length - reads;
  const failed = calls.filter((call) => call.status === 'failed').length;
  const parts = [
    reads ? `${VERB_BY_ACCESS.read} ${reads} ${reads === 1 ? 'record' : 'records'}` : null,
    writes ? `${VERB_BY_ACCESS.write} ${writes}` : null,
    failed ? `${failed} failed` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** The run still doing work, if any: the one to stop. */
export function activeRun(runs: readonly AssistantRunDto[]): AssistantRunDto | null {
  return (
    [...runs]
      .reverse()
      .find((run) => run.status === 'queued' || run.status === 'running' || run.status === 'awaiting_approval') ??
    null
  );
}
