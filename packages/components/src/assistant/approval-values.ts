/**
 * How one value of a change is shown to the person approving it. School
 * office staff decide on these, so nothing is shown as raw JSON:
 * - `text`: a plain value ("Yes", "12 Mar 2026", "Maths, Science").
 * - `fields`: a nested record, shown as its own labelled rows.
 */
export type ApprovalValueDisplay =
  | { kind: 'text'; text: string }
  | { kind: 'fields'; fields: { key: string; label: string; value: ApprovalValueDisplay }[] };

/** Shown for a value that is missing or empty. */
export const EMPTY_VALUE = '—';

/** A field's name as words: "classTeacher" reads "Class Teacher", "start_date" reads "Start date". */
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (first) => first.toUpperCase());
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * A date the API wrote as text, in the reader's words; null when the text is
 * not a date. A date without a time is a calendar day, so it is read as
 * local midnight: parsed as UTC it would show the day before in time zones
 * behind UTC.
 */
function dateText(value: string, locale?: string): string | null {
  const day = DATE_ONLY.exec(value);
  if (day) {
    const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    // "2026-02-31" rolls over to March; that is not the date that was written.
    if (date.getDate() !== Number(day[3])) return null;
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  }
  if (!DATE_TIME.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function primitiveText(value: unknown, locale?: string): string | null {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return dateText(value, locale) ?? value;
  return null;
}

/**
 * Turns one input value of a change into what the approval request shows.
 * Every value the change will write is shown: the person approving must be
 * able to check each one (marks, sections, timetable slots), so nothing is
 * ever replaced by a count. The request section scrolls when it is long.
 *
 * - Empty values are a dash; true and false are "Yes" and "No".
 * - Dates written as text are shown as dates.
 * - A list of plain values is joined with commas.
 * - Any other list shows each entry as its own numbered row ("1", "2", …),
 *   and a record becomes labelled rows; both nest as deep as the value goes.
 *
 * `locale` is a parameter for tests; callers leave it out.
 */
export function approvalValueDisplay(value: unknown, locale?: string): ApprovalValueDisplay {
  const text = primitiveText(value, locale);
  if (text !== null) return { kind: 'text', text };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'text', text: EMPTY_VALUE };
    const parts = value.map((entry) => primitiveText(entry, locale));
    if (parts.every((part): part is string => part !== null)) return { kind: 'text', text: parts.join(', ') };
    return {
      kind: 'fields',
      fields: value.map((entry, index) => ({
        key: String(index),
        label: String(index + 1),
        value: approvalValueDisplay(entry, locale),
      })),
    };
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return { kind: 'text', text: EMPTY_VALUE };
    return {
      kind: 'fields',
      fields: entries.map(([key, entry]) => ({
        key,
        label: humanizeKey(key),
        value: approvalValueDisplay(entry, locale),
      })),
    };
  }
  // Nothing JSON can carry reaches here; say so rather than print a type name.
  return { kind: 'text', text: EMPTY_VALUE };
}
