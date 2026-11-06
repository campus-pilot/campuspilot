/**
 * Calendar arithmetic for demo seeding. Every relative date derives from the
 * workflow's journaled `asOf` instant interpreted in the session's finance
 * time zone, so a replay computes the same months, windows and states.
 * Local dates are `YYYY-MM-DD` strings handled as UTC calendar days.
 */

export type LocalDate = string;

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function toUtcDay(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function fromUtcDay(value: number): LocalDate {
  const date = new Date(value);
  return formatLocalDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcDay(toUtcDay(date) + days * DAY_MS);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcDay(to) - toUtcDay(from)) / DAY_MS);
}

/** The first day of the month `offset` months after `year`/`month` (1-based). */
export function addMonths(year: number, month: number, offset: number) {
  const index = year * 12 + (month - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: LocalDate): number {
  return new Date(toUtcDay(date)).getUTCDay();
}

/** The civil date of an instant in an IANA time zone. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return formatLocalDate(value('year'), value('month'), value('day'));
}

/** Offset of `timeZone` from UTC at `instant`, in minutes. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** The instant of a local wall-clock time, as an ISO 8601 UTC string. */
export function localTimeInstant(date: LocalDate, hour: number, minute: number, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = zoneOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60000).toISOString();
}

export type BillingMonth = {
  /** 0 for the session's first month. */
  index: number;
  billingDate: LocalDate;
  periodKey: string;
};

/**
 * Billing months from the session start through the month containing `asOf`,
 * clipped to the twelve months of the session. A session starting after
 * `asOf` has none; one that has ended has all twelve.
 */
export function billingMonths(input: {
  startYear: number;
  cycleStartMonth: number;
  asOfLocal: LocalDate;
}): BillingMonth[] {
  const [asOfYear, asOfMonth] = input.asOfLocal.split('-').map(Number) as [number, number];
  const elapsed = asOfYear * 12 + (asOfMonth - 1) - (input.startYear * 12 + (input.cycleStartMonth - 1));
  const count = Math.max(0, Math.min(12, elapsed + 1));
  return Array.from({ length: count }, (_, index) => {
    const { year, month } = addMonths(input.startYear, input.cycleStartMonth, index);
    return {
      index,
      billingDate: formatLocalDate(year, month, 1),
      periodKey: `monthly:${pad(year, 4)}-${pad(month)}`,
    };
  });
}

/** Exam days skip Sundays; two timetable slots per day. */
export function examDays(start: LocalDate, slots: number): LocalDate[] {
  const days: LocalDate[] = [];
  let cursor = start;
  while (days.length < Math.ceil(slots / 2)) {
    if (weekday(cursor) !== 0) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Monday-to-Saturday school days in the inclusive range. */
export function workingDaysBetween(from: LocalDate, to: LocalDate): number {
  let count = 0;
  for (let cursor = from; daysBetween(cursor, to) >= 0; cursor = addDays(cursor, 1)) {
    if (weekday(cursor) !== 0) count += 1;
  }
  return count;
}

export type ExamState = 'ready' | 'active' | 'completed';

/**
 * Exam lifecycle as of `asOf`: `ready` before its window opens; `active`
 * from the first exam day until `activeWithinDays` after the last (marks
 * still being entered); `completed` afterwards.
 */
export function examStateAt(window: { start: LocalDate; end: LocalDate }, asOfLocal: LocalDate, activeWithinDays: number): ExamState {
  if (daysBetween(asOfLocal, window.start) > 0) return 'ready';
  if (daysBetween(window.end, asOfLocal) <= activeWithinDays) return 'active';
  return 'completed';
}

/** Share of students with marks entered while an exam is active. */
export function enteredShareAt(window: { start: LocalDate; end: LocalDate }, asOfLocal: LocalDate, activeWithinDays: number): number {
  const length = Math.max(1, daysBetween(window.start, window.end) + 1);
  const sinceStart = daysBetween(window.start, asOfLocal) + 1;
  if (sinceStart <= length) return Math.max(0, Math.min(0.5, (sinceStart / length) * 0.5));
  const after = daysBetween(window.end, asOfLocal);
  return Math.min(0.9, 0.5 + (after / Math.max(1, activeWithinDays)) * 0.4);
}
