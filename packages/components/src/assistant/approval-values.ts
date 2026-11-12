import { SUPPORTED_CURRENCY_MINOR_UNITS } from '@campuspilot/db/schema/jsonb/currencies';

import { formatMinor } from '../finance/finance-model';

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

/**
 * How values are read for the person approving.
 * - `locale`: a parameter for tests; callers leave it out.
 * - `currency`: the currency of money amounts in this input that do not name
 *   their own (an object with a `*Minor` field and no sibling `currency`).
 *   Only the app knows it, per tool (for example a manual bill's lines are in
 *   its session's finance currency), so it is passed in, never guessed. Left
 *   out, such amounts are shown as minor units, labelled as such.
 */
export type ApprovalDisplayOptions = {
  locale?: string;
  currency?: string;
  /**
   * Input paths of records whose values are all minor-unit amounts keyed by
   * fee slug (for example `['runValues', 'classes', '*']`; `*` matches any
   * one key). Their keys carry no `Minor` suffix, so only the app, per tool,
   * can say they are money. Their values use `currency` like any amount that
   * names none.
   */
  moneyMaps?: readonly ApprovalPath[];
};

/** A path into a tool input; `*` matches any one key or list index. */
export type ApprovalPath = readonly string[];

/** True when `path` is one of the declared `moneyMaps`. */
export function isMoneyMapPath(path: ApprovalPath, moneyMaps: readonly ApprovalPath[] = []): boolean {
  return moneyMaps.some(
    (pattern) => pattern.length === path.length && pattern.every((segment, index) => segment === '*' || segment === path[index]),
  );
}

/** `amountMinor`, `totalAmountMinor`: money in a currency's minor units (the API's naming). */
const MINOR_KEY = /^(.+)Minor$/;
const INTEGER = /^-?(0|[1-9]\d*)$/;

const isSupportedCurrency = (value: unknown): value is string =>
  typeof value === 'string' && Object.hasOwn(SUPPORTED_CURRENCY_MINOR_UNITS, value);

/**
 * A minor-unit amount as money ("₹1,250.00"), with the platform's billing
 * formatter. The currency is the object's own `currency` when it names a
 * supported one, else the explicit fallback; with neither, the raw integer
 * is shown with its unit spelled out, so no one mistakes paise for rupees.
 * Null when the value is not an integer amount (shown as any other value).
 */
function moneyText(value: unknown, siblingCurrency: unknown, fallbackCurrency: string | undefined): string | null {
  const minor = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof minor !== 'string' || !INTEGER.test(minor)) return null;
  const currency = isSupportedCurrency(siblingCurrency)
    ? siblingCurrency
    : siblingCurrency === undefined && isSupportedCurrency(fallbackCurrency)
      ? fallbackCurrency
      : null;
  return currency ? formatMinor(minor, currency) : `${minor} (minor units)`;
}

/**
 * The labelled rows of a record at `path` in the input. A `*Minor` amount is
 * read as money in the record's own `currency` (or the explicit fallback,
 * see `ApprovalDisplayOptions`) and labelled without the suffix ("Amount").
 * Every value of a declared money map is read as money in the fallback.
 */
export function approvalRecordFields(
  record: Record<string, unknown>,
  options: ApprovalDisplayOptions = {},
  path: ApprovalPath = [],
): Extract<ApprovalValueDisplay, { kind: 'fields' }>['fields'] {
  const moneyMap = isMoneyMapPath(path, options.moneyMaps);
  return Object.entries(record).map(([key, entry]) => {
    const minorKey = MINOR_KEY.exec(key);
    if (moneyMap || minorKey) {
      const text = moneyText(entry, moneyMap ? undefined : record.currency, options.currency);
      if (text !== null) return { key, label: humanizeKey(minorKey && !moneyMap ? minorKey[1]! : key), value: { kind: 'text', text } };
    }
    return { key, label: humanizeKey(key), value: valueDisplay(entry, options, [...path, key]) };
  });
}

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
 * - Money amounts (`*Minor` fields and declared money maps) are shown as
 *   money, see `approvalRecordFields`.
 * - A list of plain values is joined with commas.
 * - Any other list shows each entry as its own numbered row ("1", "2", …),
 *   and a record becomes labelled rows; both nest as deep as the value goes.
 */
export function approvalValueDisplay(value: unknown, options: ApprovalDisplayOptions = {}): ApprovalValueDisplay {
  return valueDisplay(value, options, []);
}

/** `approvalValueDisplay` for the value at `path` in the input. */
function valueDisplay(value: unknown, options: ApprovalDisplayOptions, path: ApprovalPath): ApprovalValueDisplay {
  const { locale } = options;
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
        value: valueDisplay(entry, options, [...path, String(index)]),
      })),
    };
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) return { kind: 'text', text: EMPTY_VALUE };
    return { kind: 'fields', fields: approvalRecordFields(value, options, path) };
  }
  // Nothing JSON can carry reaches here; say so rather than print a type name.
  return { kind: 'text', text: EMPTY_VALUE };
}
