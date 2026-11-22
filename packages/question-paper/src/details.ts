/**
 * The details of a standalone question paper (docs/personal-space.md): the
 * school, class, subject and exam names the paper itself prints. A standalone
 * paper has no exam plan, so these are what lists, filters and file names
 * show. They are written by whoever writes the paper (the generation job's
 * model, a chat agent) and are untrusted text: every value is normalised and
 * capped here, never refused, and an empty value means the paper does not
 * state it (null).
 *
 * Pure, like the rest of this package: the API, the worker and the browser
 * import it.
 */

/** The most characters one detail keeps; longer values are cut. */
export const QUESTION_PAPER_DETAIL_MAX_CHARS = 160;

/** The four details, each null when the paper does not state it. */
export type QuestionPaperDetails = {
  schoolName: string | null;
  className: string | null;
  subjectName: string | null;
  examName: string | null;
};

export const QUESTION_PAPER_DETAIL_KEYS = ['schoolName', 'className', 'subjectName', 'examName'] as const satisfies ReadonlyArray<keyof QuestionPaperDetails>;

/** No detail stated. */
export const EMPTY_QUESTION_PAPER_DETAILS: QuestionPaperDetails = { schoolName: null, className: null, subjectName: null, examName: null };

// C0 and C1 control characters and DEL; whitespace runs are collapsed first, so tabs and line breaks become spaces.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * One detail as stored: a string with its whitespace collapsed, control
 * characters removed, trimmed and cut to {@link QUESTION_PAPER_DETAIL_MAX_CHARS}
 * (by code point, so a surrogate pair is never split); null for anything else
 * or nothing left.
 */
export function normalizeQuestionPaperDetail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').replace(CONTROL, '').trim();
  if (cleaned === '') return null;
  const points = Array.from(cleaned);
  return points.length > QUESTION_PAPER_DETAIL_MAX_CHARS ? points.slice(0, QUESTION_PAPER_DETAIL_MAX_CHARS).join('').trim() : cleaned;
}

/** All four details from any value (a parsed JSON object, a tool input); unknown keys are ignored. */
export function normalizeQuestionPaperDetails(value: unknown): QuestionPaperDetails {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    schoolName: normalizeQuestionPaperDetail(record.schoolName),
    className: normalizeQuestionPaperDetail(record.className),
    subjectName: normalizeQuestionPaperDetail(record.subjectName),
    examName: normalizeQuestionPaperDetail(record.examName),
  };
}

/** The info string of the fenced block in which the generation job's model returns the details. */
export const QUESTION_PAPER_DETAILS_FENCE = 'paper-details';

// A fenced block labelled paper-details, closed or not (an answer cut off by the output limit). Linear: the label is a
// literal, the body a lazy run up to the first closing fence.
const DETAILS_BLOCK = /```paper-details[ \t]*\r?\n([\s\S]*?)(?:```|$)/;

/** The most characters of a details block that are parsed; a longer block is not details. */
const DETAILS_BLOCK_MAX_CHARS = 4_000;

/**
 * Splits the generation job's answer for a standalone paper into the text that
 * holds the fragment and the details (`paper-details` fenced JSON). The block
 * is removed from the text whether or not it parses, so it can never be taken
 * for the paper (`extractQuestionPaperFragment` keeps the longest fenced
 * block). A missing, oversized or malformed block gives no details: the paper
 * is still saved, and lists it without them.
 */
export function splitQuestionPaperDetails(text: string): { text: string; details: QuestionPaperDetails } {
  const match = DETAILS_BLOCK.exec(text);
  if (!match) return { text, details: EMPTY_QUESTION_PAPER_DETAILS };
  const rest = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`;
  const body = match[1] ?? '';
  if (body.length > DETAILS_BLOCK_MAX_CHARS) return { text: rest, details: EMPTY_QUESTION_PAPER_DETAILS };
  try {
    return { text: rest, details: normalizeQuestionPaperDetails(JSON.parse(body)) };
  } catch {
    return { text: rest, details: EMPTY_QUESTION_PAPER_DETAILS };
  }
}
