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
  /** The school the draft was checked for (the call's own input). */
  schoolId: string;
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
      schoolId: input.data.schoolId,
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

/** The template an editor is open on: the draft must be of its school and type to be shown there. */
export type TemplateEditorScope = { schoolId: string; documentType: string };

/**
 * Whether a draft belongs to the template open in the editor: proposed for
 * the same school and the same document type. A conversation reopened in
 * another type's editor (an old `?chat=` link) can hold drafts of another
 * template; those are only described, never loaded.
 */
export const draftBelongsTo = (draft: TemplateDraft, scope: TemplateEditorScope) =>
  draft.schoolId === scope.schoolId && draft.documentType === scope.documentType;

/**
 * The newest ready draft of this school's template of this document type
 * that was proposed after the template on screen was saved (`savedAt`, the
 * revision's creation time). A draft from before that save belongs to an
 * older revision (often the one just saved from it), so it is not offered as
 * an unsaved change. Both times are the server's, so no clock of the
 * browser is involved.
 */
export function latestTemplateDraftOf(
  drafts: readonly TemplateDraft[],
  facts: TemplateEditorScope & { savedAt: Date },
): TemplateDraft | null {
  for (let index = drafts.length - 1; index >= 0; index -= 1) {
    const draft = drafts[index]!;
    if (draftBelongsTo(draft, facts) && isReadyTemplateDraft(draft) && draft.writtenAt > facts.savedAt) return draft;
  }
  return null;
}

/**
 * The person's own working copy, as four independent facts:
 * - `content`: the source they hold (the saved revision until they edit,
 *   reload, restore or choose a draft);
 * - `edited`: whether they chose it since the editor opened;
 * - `over`: the newest draft (its call id) when they last chose, null when
 *   there was none;
 * - `editedSinceSend`: whether they changed it by hand (typing, Restore,
 *   Reload saved) since their last message to the assistant was sent. It is
 *   the snapshot taken at sending: the model drafts from what it was sent,
 *   so a draft that arrives after a later hand change would discard that
 *   change.
 */
export type TemplateWorkingCopy = { content: string; edited: boolean; over: string | null; editedSinceSend: boolean };

/**
 * What the editor shows: `content`; `draft`, the assistant's draft when that
 * is what is shown; `held`, a newer draft that is NOT shown because the
 * person changed their working copy after sending (the editor offers it with
 * "Replace my edits").
 */
export type TemplateEditorSource = { content: string; draft: TemplateDraft | null; held: TemplateDraft | null };

/**
 * The template the editor holds, from the working copy and the assistant's
 * newest ready draft (`latest`). Derived on every render, so a draft that
 * arrives while the editor is open shows at once, with no effect.
 * - No draft, or the person chose after the newest one arrived (they edited
 *   it, or showed it): their working copy.
 * - A newer draft, and they have not changed the working copy by hand since
 *   their last message: the draft, shown in the code and the preview.
 * - A newer draft, but they changed the working copy since sending: their
 *   working copy stays, and the draft is `held`, never shown by itself.
 */
export function editorSourceOf(manual: TemplateWorkingCopy, latest: TemplateDraft | null): TemplateEditorSource {
  if (!latest || (manual.edited && manual.over === latest.callId)) return { content: manual.content, draft: null, held: null };
  if (manual.editedSinceSend) return { content: manual.content, draft: null, held: latest };
  return { content: latest.content, draft: latest, held: null };
}

/**
 * The working copy that keeps what is on screen when the draft showing it
 * goes away (a new chat has no drafts): a shown draft becomes the working
 * copy, unsaved, as if the person had chosen it. Anything else is unchanged.
 */
export function adoptShownSource(manual: TemplateWorkingCopy, shown: TemplateEditorSource): TemplateWorkingCopy {
  return shown.draft ? { ...manual, content: shown.content, edited: true, over: shown.draft.callId } : manual;
}

/** Where a draft card stands for the editor beside the chat (`TemplateDraftCardStatus`). */
export function templateDraftStatusOf(
  draft: TemplateDraft,
  editor: { scope: TemplateEditorScope; source: TemplateEditorSource; savedAt: Date },
): 'elsewhere' | 'shown' | 'held' | 'saved-before' | 'available' {
  if (!draftBelongsTo(draft, editor.scope)) return 'elsewhere';
  if (draft.content === editor.source.content) return 'shown';
  if (draft.writtenAt <= editor.savedAt) return 'saved-before';
  if (editor.source.held?.callId === draft.callId) return 'held';
  return 'available';
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
