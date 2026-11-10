/**
 * Calendar days and months of assistant usage are Indian Standard Time
 * (Asia/Kolkata), the time zone the schools work in: a month is the 1st to
 * the last day in IST. IST is a fixed UTC+05:30 with no daylight saving (none
 * since 1945), so the offset is exact all year. Saved timestamps stay
 * `timestamptz`; only grouping and boundaries use IST.
 */
export const IST_TIME_ZONE = 'Asia/Kolkata';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The IST calendar date (`YYYY-MM-DD`) of an instant. */
export function istDate(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant an IST calendar date (`YYYY-MM-DD`) starts. */
export function istDayStart(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

/** The IST month (`YYYY-MM`) of an instant and the instants it starts and ends (exclusive). */
export function istMonthOf(instant: Date): { month: string; start: Date; end: Date } {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  return {
    month: `${year}-${String(month + 1).padStart(2, '0')}`,
    start: new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - IST_OFFSET_MS),
  };
}
