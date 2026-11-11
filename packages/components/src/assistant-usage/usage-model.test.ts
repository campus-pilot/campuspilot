import { describe, expect, it } from 'vitest';

import { formatInr, formatSpend, groupUsage, rangeForPreset, type UsageDay } from './usage-model';

const day = (date: string, costUsd: string, requests = 1): UsageDay => ({
  date,
  requests,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  costUsd,
});

describe('rangeForPreset', () => {
  // 2026-11-30 20:00 UTC is already 1 December in IST.
  const lateNovemberUtc = new Date('2026-11-30T20:00:00Z');

  it('counts days in IST, today included', () => {
    expect(rangeForPreset('last7', lateNovemberUtc)).toEqual({ from: '2026-11-25', to: '2026-12-01' });
    expect(rangeForPreset('currentMonth', lateNovemberUtc)).toEqual({ from: '2026-12-01', to: '2026-12-01' });
    expect(rangeForPreset('lastMonth', lateNovemberUtc)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('crosses a year for last month in January, and has no range for custom', () => {
    expect(rangeForPreset('lastMonth', new Date('2027-01-15T06:00:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(rangeForPreset('custom', lateNovemberUtc)).toBeNull();
  });
});

describe('groupUsage', () => {
  it('adds days up per month exactly', () => {
    const months = groupUsage([day('2026-11-30', '0.1'), day('2026-12-01', '0.2'), day('2026-12-02', '0.00000001', 2)], 'month');
    expect(months.map(({ period, requests, costUsd }) => [period, requests, costUsd])).toEqual([
      ['2026-11', 1, '0.1'],
      ['2026-12', 3, '0.20000001'],
    ]);
  });
});

describe('formatSpend', () => {
  it('shows dollars, and rupees at the viewer’s rate rounded to the paisa', () => {
    expect(formatSpend('12.5', null)).toBe('$12.50');
    expect(formatInr('12.5', '84.25')).toBe('₹1,053.13');
    expect(formatSpend('0.0005', '84')).toBe('$0.0005 (₹0.04)');
    expect(formatInr('100000', '84')).toBe('₹84,00,000.00');
  });
});
