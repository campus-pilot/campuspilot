/**
 * One human sentence per tool for the approval request, built from the tool's
 * input and facts the app resolved for it (names behind ids, a draft's place
 * in the chat). Without an entry the request falls back to the generic list of
 * labelled values (`approvalValueDisplay`), which is right for most tools.
 *
 * An entry exists when the input alone cannot be checked by the person who
 * approves it: ids and slugs, a hash that names a draft, or a body of text far
 * too long to read in the request. Such an entry:
 * - writes the sentence the person approves ("Save Draft 2 as version 4 of ...");
 * - moves identifier-like keys behind a collapsed "Details" disclosure instead
 *   of dropping them, so nothing is hidden for good;
 * - replaces a very long text value by a note with its size, so it is never dumped.
 *
 * Pure and presentational: the component package makes no API call, the app
 * supplies `ApprovalFacts` (see `approvalPaperScope`) and passes the result in.
 */

export type ApprovalFacts = {
  /** "Mathematics (Oral), Class 5, Annual Examination", once the app has resolved the paper; null while unknown. */
  paperLabel: string | null;
  /** "2" for "Draft 2": the draft card in this chat the input's draft id names, or null when none is known. */
  draftOrdinal: number | null;
};

export type ApprovalSummary = {
  /** What the person approves, as one sentence. */
  sentence: string;
  /** Input keys shown only behind "Details" (ids, slugs, counters). */
  detailKeys: ReadonlySet<string>;
  /** Input keys whose value is replaced everywhere by this note (a paper's text). */
  notes: Readonly<Record<string, string>>;
};

/** The class, exam and subject of a paper, as the app needs them to look up its names. */
export type ApprovalPaperScope = { sessionId: string; examSlug: string; classId: string; subjectSlug: string; modeSlug: string };

type SummaryEntry = {
  /** The paper the input is about, so the app can resolve its names; null when this input names none. */
  paperScope(input: Record<string, unknown>): ApprovalPaperScope | null;
  summarize(input: Record<string, unknown>, facts: ApprovalFacts): ApprovalSummary;
};

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

function scopeOf(input: Record<string, unknown>): ApprovalPaperScope | null {
  const scope = {
    sessionId: text(input.sessionId),
    examSlug: text(input.examSlug),
    classId: text(input.classId),
    subjectSlug: text(input.subjectSlug),
    modeSlug: text(input.modeSlug),
  };
  return Object.values(scope).every((part) => part !== null) ? (scope as ApprovalPaperScope) : null;
}

/** `saveQuestionPaperVersion`: which paper, which draft and which version number it becomes. */
const saveQuestionPaperVersion: SummaryEntry = {
  paperScope: scopeOf,
  summarize(input, facts) {
    const html = text(input.html);
    const what = html
      ? `the paper text (${html.length.toLocaleString('en-US')} characters)`
      : facts.draftOrdinal
        ? `Draft ${facts.draftOrdinal}`
        : 'the draft';
    // The next version number is the expected latest plus one (a changed paper is refused as a conflict, never overwritten).
    const expected = typeof input.expectedVersionNo === 'number' ? input.expectedVersionNo : null;
    const version = expected === null ? 'a new version' : `version ${expected + 1}`;
    const notes: Record<string, string> = html ? { html: `Paper text, ${html.length.toLocaleString('en-US')} characters (not shown)` } : {};
    return {
      sentence: `Save ${what} as ${version} of ${facts.paperLabel ?? 'this paper'}.`,
      detailKeys: new Set(['sessionId', 'examSlug', 'classId', 'subjectSlug', 'modeSlug', 'draftId', 'expectedVersionNo']),
      notes,
    };
  },
};

/** The tools with a summary, by the MCP name a `tool_call` item stores as `toolName`. */
const APPROVAL_SUMMARIES: Readonly<Record<string, SummaryEntry>> = {
  'school.saveQuestionPaperVersion': saveQuestionPaperVersion,
};

const asRecord = (input: unknown): Record<string, unknown> | null =>
  typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;

/** The paper a call's input is about, when the tool has a summary that needs its names; null otherwise. */
export function approvalPaperScope(toolName: string, input: unknown): ApprovalPaperScope | null {
  const record = asRecord(input);
  return record ? (APPROVAL_SUMMARIES[toolName]?.paperScope(record) ?? null) : null;
}

/** Whether the app should resolve the draft's ordinal for this tool's summary (it names a `draftId`). */
export const approvalDraftId = (toolName: string, input: unknown): string | null =>
  APPROVAL_SUMMARIES[toolName] ? text(asRecord(input)?.draftId) : null;

/** The summary of a call's input, or null when the tool has none (the generic list is shown). */
export function approvalSummaryOf(toolName: string, input: unknown, facts: ApprovalFacts): ApprovalSummary | null {
  const record = asRecord(input);
  return record ? (APPROVAL_SUMMARIES[toolName]?.summarize(record, facts) ?? null) : null;
}
