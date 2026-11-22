/**
 * The details of a standalone question paper (docs/personal-space.md): the
 * school, class, subject and exam names and the maximum marks the paper
 * itself prints. A standalone
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

/**
 * The largest maximum marks a paper's details keep: a bound for a model's
 * untrusted answer (a larger number is not a detail), equal to the database
 * CHECK on `exam_question_paper.details_max_marks`.
 */
export const QUESTION_PAPER_DETAIL_MAX_MARKS = 10_000;

/** The five details, each null when the paper does not state it. */
export type QuestionPaperDetails = {
  schoolName: string | null;
  className: string | null;
  subjectName: string | null;
  examName: string | null;
  /** The paper's maximum marks, a whole number from 1 to {@link QUESTION_PAPER_DETAIL_MAX_MARKS}. */
  maxMarks: number | null;
};

/** The four text details (names); {@link QuestionPaperDetails.maxMarks} is a number and listed apart. */
export const QUESTION_PAPER_DETAIL_KEYS = ['schoolName', 'className', 'subjectName', 'examName'] as const satisfies ReadonlyArray<keyof QuestionPaperDetails>;

/** No detail stated. */
export const EMPTY_QUESTION_PAPER_DETAILS: QuestionPaperDetails = { schoolName: null, className: null, subjectName: null, examName: null, maxMarks: null };

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

/**
 * The maximum marks as stored: a whole number from 1 to
 * {@link QUESTION_PAPER_DETAIL_MAX_MARKS}, given as a number or as text that
 * is only that number ("80", " 80 "); null for anything else (a fraction, a
 * range, words, out of bounds), never refused.
 */
export function normalizeQuestionPaperMaxMarks(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d{1,5}\s*$/.test(value) ? Number(value) : Number.NaN;
  return Number.isInteger(number) && number >= 1 && number <= QUESTION_PAPER_DETAIL_MAX_MARKS ? number : null;
}

/** All five details from any value (a parsed JSON object, a tool input); unknown keys are ignored. */
export function normalizeQuestionPaperDetails(value: unknown): QuestionPaperDetails {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    schoolName: normalizeQuestionPaperDetail(record.schoolName),
    className: normalizeQuestionPaperDetail(record.className),
    subjectName: normalizeQuestionPaperDetail(record.subjectName),
    examName: normalizeQuestionPaperDetail(record.examName),
    maxMarks: normalizeQuestionPaperMaxMarks(record.maxMarks),
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
 * block). A missing, oversized or malformed block gives no details (`found`
 * false): the paper is still saved, and lists it without them.
 */
export function splitQuestionPaperDetails(text: string): { text: string; details: QuestionPaperDetails; found: boolean } {
  const match = DETAILS_BLOCK.exec(text);
  if (!match) return { text, details: EMPTY_QUESTION_PAPER_DETAILS, found: false };
  const rest = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`;
  const body = match[1] ?? '';
  if (body.length > DETAILS_BLOCK_MAX_CHARS) return { text: rest, details: EMPTY_QUESTION_PAPER_DETAILS, found: false };
  try {
    return { text: rest, details: normalizeQuestionPaperDetails(JSON.parse(body)), found: true };
  } catch {
    return { text: rest, details: EMPTY_QUESTION_PAPER_DETAILS, found: false };
  }
}
