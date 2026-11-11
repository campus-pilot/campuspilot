import { describe, expect, it } from 'vitest';

import { formatDayAware, formatElapsed, formatStepDuration } from './message-time';

/** Local-time dates, since "today" and "yesterday" are the reader's calendar days. */
const local = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);
const now = local(2026, 11, 10, 15, 0);

describe('formatDayAware', () => {
  it('shows only the time for a message from today', () => {
    expect(formatDayAware(local(2026, 11, 10, 14, 29), now, 'en-US')).toBe('2:29 PM');
    expect(formatDayAware(local(2026, 11, 10, 0, 5), now, 'en-US')).toBe('12:05 AM');
  });

  it('names yesterday, by calendar day rather than by hours elapsed', () => {
    // 16 hours ago, but the day before.
    expect(formatDayAware(local(2026, 11, 9, 23, 0), now, 'en-US')).toBe('Yesterday at 11:00 PM');
    // More than 24 hours ago, still the day before.
    expect(formatDayAware(local(2026, 11, 9, 0, 1), now, 'en-US')).toBe('Yesterday at 12:01 AM');
  });

  it('shows the date and the time for anything older', () => {
    expect(formatDayAware(local(2026, 11, 6, 14, 29), now, 'en-US')).toBe('Nov 6, 2:29 PM');
    expect(formatDayAware(local(2026, 1, 2, 9, 0), now, 'en-US')).toBe('Jan 2, 9:00 AM');
  });

  it('adds the year once the message is from another year', () => {
    expect(formatDayAware(local(2025, 12, 31, 18, 45), now, 'en-US')).toBe('Dec 31, 2025, 6:45 PM');
  });

  it('counts the day across a month boundary', () => {
    expect(formatDayAware(local(2026, 10, 31, 8, 0), local(2026, 11, 1, 9, 0), 'en-US')).toBe('Yesterday at 8:00 AM');
  });

  it('follows the locale it is given', () => {
    expect(formatDayAware(local(2026, 11, 6, 14, 29), now, 'en-GB')).toBe('6 Nov, 14:29');
  });
});

describe('formatElapsed', () => {
  it('shows seconds, then minutes with two-digit seconds', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(12.9)).toBe('12s');
    expect(formatElapsed(65)).toBe('1m 05s');
    expect(formatElapsed(-3)).toBe('0s');
  });
});

describe('formatStepDuration', () => {
  const from = new Date('2026-11-10T09:00:00.000Z');
  const after = (ms: number) => new Date(from.getTime() + ms);

  it('shows tenths of a second for a step faster than a second', () => {
    expect(formatStepDuration(from, after(430))).toBe('0.4s');
    expect(formatStepDuration(from, after(999))).toBe('0.9s');
  });

  it('shows nothing for a step under a tenth of a second', () => {
    expect(formatStepDuration(from, after(20))).toBeNull();
    expect(formatStepDuration(from, after(99))).toBeNull();
    expect(formatStepDuration(from, after(0))).toBeNull();
    expect(formatStepDuration(from, after(100))).toBe('0.1s');
  });

  it('shows whole seconds and minutes from one second up', () => {
    expect(formatStepDuration(from, after(1000))).toBe('1s');
    expect(formatStepDuration(from, after(2700))).toBe('2s');
    expect(formatStepDuration(from, after(61_000))).toBe('1m 01s');
  });

  it('shows nothing for timestamps out of order', () => {
    expect(formatStepDuration(after(500), from)).toBeNull();
  });
});
