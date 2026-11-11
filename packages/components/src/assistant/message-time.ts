const DAY_MS = 86_400_000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * When a message was sent, as short as its age allows (after T3 Code's
 * timestamps): the time alone for today, "Yesterday at 2:29 PM" for
 * yesterday, and the date with the time for anything older (with the year
 * once it is not this year). Days are calendar days in the reader's time
 * zone, so a message from 11 PM last night is "Yesterday", not "1 day ago".
 *
 * `now` and `locale` are parameters so the result can be tested; callers
 * leave `locale` out to use the reader's own.
 */
export function formatDayAware(at: Date, now: Date = new Date(), locale?: string): string {
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at);
  const daysAgo = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `Yesterday at ${time}`;
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(at);
  return `${date}, ${time}`;
}

/** Elapsed time for a turn or a step: "0.4s", "12s", "1m 05s". */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * How long one step took, from when it began to when its result was saved,
 * or null for a step that took under a tenth of a second: most lookups do,
 * and a column of "<0.1s" would say nothing. Steps under a second show
 * tenths ("0.4s", rounded down, never up to a time it did not take).
 */
export function formatStepDuration(from: Date, to: Date): string | null {
  const ms = to.getTime() - from.getTime();
  if (ms < 100) return null;
  if (ms < 1000) return `${Math.floor(ms / 100) / 10}s`;
  return formatElapsed(ms / 1000);
}
