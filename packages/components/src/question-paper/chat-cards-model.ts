import { z } from 'zod';

import type { AssistantTimelineRow } from '../assistant/timeline-model';

/**
 * Pure reading of a `validateQuestionPaperDraft` tool call for its chat card
 * (design G5). The call item stores the tool's input whole and its output cut
 * to 4,000 characters for display, so the card reads the output defensively:
 * when it is cut or unreadable the caller validates the stored input again.
 */

const issueSchema = z.object({ path: z.string(), message: z.string() });
const warningSchema = z.object({ code: z.string(), path: z.string(), message: z.string() });

/** The result of the validate tool, as the API's `validateDraftOutputSchema` returns it. */
export const draftResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(issueSchema),
  warnings: z.array(warningSchema),
  total: z.number().nullable(),
  planMaxMarks: z.number().nullable(),
  draftId: z.string().nullable(),
  placeholderFigures: z.number().int(),
});
export type DraftResult = z.infer<typeof draftResultSchema>;

/** Everything the draft card shows. */
export type DraftCardFacts =
  | { valid: false; errors: DraftResult['errors'] }
  | {
      valid: true;
      draftId: string;
      total: number | null;
      planMaxMarks: number | null;
      warnings: DraftResult['warnings'];
      placeholderFigures: number;
    };

export function draftFactsOf(result: DraftResult): DraftCardFacts {
  return result.valid && result.draftId
    ? {
        valid: true,
        draftId: result.draftId,
        total: result.total,
        planMaxMarks: result.planMaxMarks,
        warnings: result.warnings,
        placeholderFigures: result.placeholderFigures,
      }
    : { valid: false, errors: result.errors.length > 0 ? result.errors : [{ path: '', message: 'This draft is not valid.' }] };
}

/**
 * The stored output of a validate call, or null when it cannot be trusted:
 * the display copy was cut, is not JSON, or has another shape. The tool
 * result is JSON text, possibly wrapped as `{ result: ... }` by the MCP layer.
 */
export function parseStoredDraftResult(output: string | undefined, truncated: boolean | undefined): DraftResult | null {
  if (!output || truncated) return null;
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  const direct = draftResultSchema.safeParse(value);
  if (direct.success) return direct.data;
  const inner = (value as { structuredContent?: unknown; result?: unknown } | null)?.structuredContent ?? (value as { result?: unknown } | null)?.result;
  const wrapped = draftResultSchema.safeParse(inner);
  return wrapped.success ? wrapped.data : null;
}

const paperInputSchema = z.object({
  schoolId: z.string(),
  sessionId: z.string(),
  examSlug: z.string(),
  classId: z.string(),
  subjectSlug: z.string(),
  modeSlug: z.string(),
  content: z.unknown(),
});
export type DraftCallInput = z.infer<typeof paperInputSchema>;

/** The paper key and document a validate call was made with, or null if the stored input is not that. */
export function parseDraftCallInput(input: unknown): DraftCallInput | null {
  const parsed = paperInputSchema.safeParse(input);
  return parsed.success && parsed.data.content !== undefined ? parsed.data : null;
}

/** The sentence a draft with placeholder figures carries, or null. */
export function draftCardSummary(facts: DraftCardFacts): { placeholderNote: string | null } {
  if (!facts.valid || facts.placeholderFigures === 0) return { placeholderNote: null };
  const count = facts.placeholderFigures;
  return {
    placeholderNote: `${count} ${count === 1 ? 'figure is' : 'figures are'} still a placeholder. Attach the image in chat to put it in.`,
  };
}

/** The message the card's "Save as new version" sends (an explicit user command, decision D32). */
export const saveDraftMessage = (draftId: string) => `Save draft ${draftId} as a new version.`;

/** What the conversation holds, in order, that matters to whether a draft's Save is still pending. */
export type DraftSaveEvent =
  | { kind: 'message'; text: string }
  | { kind: 'save-call'; status: 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'declined' | 'cancelled' };

/**
 * Whether the user's request to save this draft is still in flight or done,
 * so the card's button stays spent. It is spent from the user's save message
 * until a save call that followed it was declined, cancelled or failed: then
 * the request is over without a version and the button works again. Several
 * save calls after one message: the last one decides.
 */
export function draftSaveSpent(events: readonly DraftSaveEvent[], draftId: string): boolean {
  const sentence = saveDraftMessage(draftId);
  let lastMessage = -1;
  events.forEach((event, index) => {
    if (event.kind === 'message' && event.text === sentence) lastMessage = index;
  });
  if (lastMessage < 0) return false;
  const calls = events.slice(lastMessage + 1).filter((event) => event.kind === 'save-call');
  const last = calls.at(-1);
  if (!last) return true;
  return !(last.status === 'failed' || last.status === 'declined' || last.status === 'cancelled');
}

/** The conversation's save-relevant events in order: user messages and `saveQuestionPaperVersion` calls, including those folded under a work bar. */
export function saveEventsOf(rows: readonly AssistantTimelineRow[]): DraftSaveEvent[] {
  const events: DraftSaveEvent[] = [];
  const visit = (row: AssistantTimelineRow) => {
    if (row.kind === 'user') events.push({ kind: 'message', text: row.item.body.text });
    else if (row.kind === 'approval' && row.call.body.toolName.endsWith('saveQuestionPaperVersion')) {
      events.push({ kind: 'save-call', status: row.call.status });
    } else if (row.kind === 'activity') {
      for (const call of row.calls) {
        if (call.body.toolName.endsWith('saveQuestionPaperVersion')) events.push({ kind: 'save-call', status: call.status });
      }
    } else if (row.kind === 'work') row.folded.forEach(visit);
  };
  rows.forEach(visit);
  return events;
}
