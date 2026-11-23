import { z } from 'zod';

import type { AssistantTimelineRow } from '../assistant/timeline-model';

/**
 * Pure reading of the template editor's conversation (docs/document-system.md,
 * "Edit with the assistant"). The assistant proposes a template by calling
 * `validateDocumentTemplateDraft` with the complete source; the call item
 * stores that input whole and the verdict as JSON text (cut at 4,000
 * characters for display, which the verdict never reaches: it holds at most
 * two short problem lines and no source). A draft exists only in the
 * conversation: the editor shows it, the person saves it.
 */

/** The verdict of the validate tool, as the API's `validateTemplateDraftOutputSchema` returns it. */
export const templateDraftResultSchema = z.object({
  valid: z.boolean(),
  problems: z.array(z.string()),
  draftId: z.string().nullable(),
  characters: z.number().int(),
});
export type TemplateDraftResult = z.infer<typeof templateDraftResultSchema>;

/** What a validate call was made with: the school, the document type and the whole proposed source. */
const templateDraftInputSchema = z.object({
  schoolId: z.string(),
  documentType: z.string(),
  content: z.string(),
});

/**
 * The stored verdict of a validate call, or null when it cannot be read (cut,
 * not JSON, another shape). The tool result is JSON text, possibly wrapped as
 * `{ structuredContent }` or `{ result }` by the MCP layer.
 */
export function parseTemplateDraftResult(output: string | undefined, truncated: boolean | undefined): TemplateDraftResult | null {
  if (!output || truncated) return null;
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  const direct = templateDraftResultSchema.safeParse(value);
  if (direct.success) return direct.data;
  const inner =
    (value as { structuredContent?: unknown; result?: unknown } | null)?.structuredContent ??
    (value as { result?: unknown } | null)?.result;
  const wrapped = templateDraftResultSchema.safeParse(inner);
  return wrapped.success ? wrapped.data : null;
}

/** One template draft card of the conversation, as the chat and the editor read it. */
export type TemplateDraft = {
  /** The validate call's item id: unique per proposal, even when two proposals have the same source. */
  callId: string;
  /** "Draft 2": its place among the conversation's template drafts. */
  ordinal: number;
  documentType: string;
  /** The complete proposed source, exactly as the assistant sent it. */
  content: string;
  /** The stored verdict; null when it cannot be read (then it is never loaded into the editor). */
  result: TemplateDraftResult | null;
  /** When it was proposed (the call's server time), to compare with when the template was last saved. */
  writtenAt: Date;
};

const isTemplateDraftCard = (row: AssistantTimelineRow): row is Extract<AssistantTimelineRow, { kind: 'card' }> =>
  row.kind === 'card' && row.card === 'document_template_draft';

/** Every template draft of the conversation, in order (cards are never folded under a work bar). */
export function templateDraftsOf(rows: readonly AssistantTimelineRow[]): TemplateDraft[] {
  const drafts: TemplateDraft[] = [];
  for (const row of rows) {
    if (!isTemplateDraftCard(row)) continue;
    const input = templateDraftInputSchema.safeParse(row.call.body.input);
    if (!input.success) continue;
    drafts.push({
      callId: row.call.id,
      ordinal: drafts.length + 1,
      documentType: input.data.documentType,
      content: input.data.content,
      result: parseTemplateDraftResult(row.call.body.output, row.call.body.outputTruncated),
      writtenAt: row.call.createdAt,
    });
  }
  return drafts;
}

/** Whether a draft can be loaded into the editor: its verdict says it would save. */
export const isReadyTemplateDraft = (draft: TemplateDraft) => Boolean(draft.result?.valid && draft.result.draftId);

/**
 * The newest ready draft of this document type that was proposed after the
 * template on screen was saved (`savedAt`, the revision's creation time).
 * A draft from before that save belongs to an older revision (often the one
 * just saved from it), so it is not offered as an unsaved change. Both times
 * are the server's, so no clock of the browser is involved.
 */
export function latestTemplateDraftOf(
  drafts: readonly TemplateDraft[],
  facts: { documentType: string; savedAt: Date },
): TemplateDraft | null {
  for (let index = drafts.length - 1; index >= 0; index -= 1) {
    const draft = drafts[index]!;
    if (draft.documentType === facts.documentType && isReadyTemplateDraft(draft) && draft.writtenAt > facts.savedAt) return draft;
  }
  return null;
}

/**
 * The template the editor holds, from two independent facts: the person's
 * own working copy (`manual`, which starts as the saved revision and changes
 * only when they edit or reload) and the assistant's newest ready draft
 * (`latest`). The draft wins unless the person changed the working copy
 * after it arrived: `manual.over` records which draft was showing when they
 * last edited (null: none was). So a new proposal replaces what is shown, and
 * a hand edit of a proposal keeps the hand edit until the next proposal. It
 * is derived on every render, so a draft that arrives while the editor is
 * open shows at once with no effect.
 */
export function editorSourceOf(
  manual: { content: string; over: string | null; edited: boolean },
  latest: TemplateDraft | null,
): { content: string; draft: TemplateDraft | null } {
  if (latest && (!manual.edited || manual.over !== latest.callId)) return { content: latest.content, draft: latest };
  return { content: manual.content, draft: null };
}

/**
 * Whether the editor's source must go with the next message: it is what the
 * model edits, and the model already holds the source when it is the one the
 * conversation last saw (the last source sent with a message, or the
 * assistant's own newest draft, whichever came later). The first message of
 * a conversation always carries it, so the model never has to read a long
 * template through a tool whose result may be cut.
 */
export function sourceToSend(input: { current: string; lastKnown: string | null }): string | null {
  return input.lastKnown === input.current ? null : input.current;
}

/**
 * The source the conversation last saw: the newest of the sources sent with
 * user messages (`editorSource`) and the assistant's ready drafts of this
 * document type, in the conversation's order. Null when it saw none yet.
 */
export function lastKnownSourceOf(rows: readonly AssistantTimelineRow[], documentType: string): string | null {
  let known: string | null = null;
  const visit = (row: AssistantTimelineRow) => {
    if (row.kind === 'user') {
      const sent = row.item.body.editorSource;
      if (sent && sent.documentType === documentType) known = sent.content;
    } else if (isTemplateDraftCard(row)) {
      const input = templateDraftInputSchema.safeParse(row.call.body.input);
      const result = parseTemplateDraftResult(row.call.body.output, row.call.body.outputTruncated);
      if (input.success && input.data.documentType === documentType && result?.valid && result.draftId) known = input.data.content;
    } else if (row.kind === 'work') row.folded.forEach(visit);
  };
  rows.forEach(visit);
  return known;
}
