import { z } from 'zod';

import type { AssistantTimelineRow } from '../assistant/timeline-model';

/**
 * Pure reading of a `validateQuestionPaperDraft` tool call for its chat card
 * (design G5). The call item stores the tool's input whole and its output cut
 * to 4,000 characters for display, so the card reads the output defensively:
 * when it is cut or unreadable the caller validates the stored input again.
 */

/** The result of the validate tool, as the API's `validateDraftOutputSchema` returns it. */
export const draftResultSchema = z.object({
  valid: z.boolean(),
  problems: z.array(z.string()),
  stripped: z.array(z.string()),
  draftId: z.string().nullable(),
  placeholderFigures: z.number().int(),
});
export type DraftResult = z.infer<typeof draftResultSchema>;

/**
 * Everything the draft card shows. `problems` are the API's lines, written for
 * the model that fixes the paper (LaTeX source, KaTeX messages): the card turns
 * them into teacher sentences with `summarizeProblems` and keeps the raw lines
 * behind "Details". `removed` is what the sanitiser took out of the HTML (a style or attribute
 * that is not allowed): it does not block saving, so the card keeps it behind
 * a collapsed "what was removed" list.
 */
export type DraftCardFacts =
  | { valid: false; problems: readonly string[] }
  | {
      valid: true;
      draftId: string;
      removed: readonly string[];
      placeholderFigures: number;
    };

/** A draft is valid for the card only with a draft id (what Save refers to). */
export function draftFactsOf(result: DraftResult): DraftCardFacts {
  return result.valid && result.draftId
    ? {
        valid: true,
        draftId: result.draftId,
        removed: result.stripped,
        placeholderFigures: result.placeholderFigures,
      }
    : {
        valid: false,
        problems: result.problems.length > 0 ? result.problems : ['This draft is not valid.'],
      };
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
  const inner =
    (value as { structuredContent?: unknown; result?: unknown } | null)?.structuredContent ??
    (value as { result?: unknown } | null)?.result;
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
  html: z.string(),
});
export type DraftCallInput = z.infer<typeof paperInputSchema>;

/** The paper key and document a validate call was made with, or null if the stored input is not that. */
export function parseDraftCallInput(input: unknown): DraftCallInput | null {
  const parsed = paperInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/**
 * The message the card's "Save as new version" sends (an explicit user command,
 * decision D32). A draft id is the hash of the paper's HTML only, so the same
 * text validated for two papers has one id: the message names the paper
 * ("Mathematics (Oral), Class 5, Annual Examination") so the assistant saves
 * it where the user clicked, and so a card is spent only by a request for its
 * own paper. The sentence is also the key `draftSaveSpent` matches.
 */
export const saveDraftMessage = (draftId: string, paperLabel: string) => `Save draft ${draftId} as a new version of ${paperLabel}.`;

/** The paper key of a draft call as one comparable string, or null when the stored input is not a draft call. */
function paperScopeOf(input: DraftCallInput | null): string | null {
  return input ? JSON.stringify([input.sessionId, input.examSlug, input.classId, input.subjectSlug, input.modeSlug]) : null;
}

/** The draft cards of a conversation in order (cards are never folded under a work bar). */
const cardCallsOf = (rows: readonly AssistantTimelineRow[]) => rows.flatMap((row) => (row.kind === 'card' ? [row.call] : []));

/**
 * The draft cards whose stored result cannot be trusted (cut at 4,000 characters
 * or unreadable) but whose input is a draft call: the ones that need the
 * re-check for a verdict. Shared by the card (its own state) and
 * {@link supersededDrafts} (whether a later draft is ready).
 */
export function draftCallsNeedingRecheck(rows: readonly AssistantTimelineRow[]): { id: string; input: DraftCallInput }[] {
  return cardCallsOf(rows).flatMap((call) => {
    if (parseStoredDraftResult(call.body.output, call.body.outputTruncated)) return [];
    const input = parseDraftCallInput(call.body.input);
    return input ? [{ id: call.id, input }] : [];
  });
}

/**
 * For each draft card that a later draft of the same paper replaced, the
 * ordinal ("Draft 2") of the nearest later draft that is ready. Keyed by the
 * card's call id. A draft's verdict is its stored result, or, when that was cut
 * (a ready draft with a long list of removed items is cut at 4,000 characters)
 * or unreadable, the re-check's `verdicts` for that call (the chat runs the
 * re-check for those, see {@link draftCallsNeedingRecheck}). A later draft with
 * neither (the re-check is running or failed) is not counted, so a card is only
 * called replaced on evidence.
 */
export function supersededDrafts(rows: readonly AssistantTimelineRow[], verdicts: ReadonlyMap<string, DraftResult> = new Map()): Map<string, number> {
  const cards = cardCallsOf(rows).map((call) => {
    const result = parseStoredDraftResult(call.body.output, call.body.outputTruncated) ?? verdicts.get(call.id);
    return {
      id: call.id,
      scope: paperScopeOf(parseDraftCallInput(call.body.input)),
      ready: Boolean(result?.valid && result.draftId),
    };
  });
  const replaced = new Map<string, number>();
  cards.forEach((card, index) => {
    if (!card.scope) return;
    const later = cards.findIndex((candidate, at) => at > index && candidate.ready && candidate.scope === card.scope);
    if (later >= 0) replaced.set(card.id, later + 1);
  });
  return replaced;
}

/**
 * The ordinal of the newest draft card whose stored check names `draftId`, or
 * null (no such card, or its stored output was cut). Lets an approval card say
 * "Draft 2" instead of a hash.
 */
export function draftOrdinalOf(rows: readonly AssistantTimelineRow[], draftId: string): number | null {
  const calls = cardCallsOf(rows);
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]!;
    if (parseStoredDraftResult(call.body.output, call.body.outputTruncated)?.draftId === draftId) return index + 1;
  }
  return null;
}

/** What the conversation holds, in order, that matters to whether a draft's Save is still pending. */
export type DraftSaveEvent =
  | { kind: 'message'; text: string }
  | {
      kind: 'save-call';
      status: 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'declined' | 'cancelled';
    };

/**
 * Whether the user's request to save this draft is still in flight or done,
 * so the card's button stays spent. It is spent from the user's save message
 * until a save call that followed it was declined, cancelled or failed: then
 * the request is over without a version and the button works again. Several
 * save calls after one message: the last one decides.
 */
export function draftSaveSpent(events: readonly DraftSaveEvent[], sentence: string): boolean {
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
