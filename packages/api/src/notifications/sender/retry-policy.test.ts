import { describe, expect, it } from 'vitest';

import {
  channelBackoffMs,
  DAY_MS,
  decideRetry,
  QUICK_RETRY_LIMIT,
  WEB_PUSH_QUICK_RETRY_LIMIT,
  WHATSAPP_DAILY_LIMIT_RETRIES,
  type RetryCounters,
} from './retry-policy';

const now = new Date('2026-11-10T10:00:00.000Z');
const fresh: RetryCounters = { quickRetries: 0, deferredRetries: 0, dailyLimitRetries: 0 };
/** random 0.5 = no jitter. */
const delays = (channel: 'whatsapp' | 'web_push', failure: Parameters<typeof decideRetry>[1]) => {
  const result: number[] = [];
  let counters = fresh;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const decision = decideRetry(channel, failure, counters, now, 0.5);
    if (decision.kind === 'give_up') break;
    result.push(decision.nextAttemptAt.getTime() - now.getTime());
    counters = decision.counters;
  }
  return result;
};

describe('retry policy (D-41)', () => {
  it('gives WhatsApp transient failures 4 quick retries, then one a day later, then gives up', () => {
    expect(delays('whatsapp', {})).toEqual([60_000, 240_000, 960_000, 3_840_000, DAY_MS + 15 * 60_000]);
  });

  it('retries a reached daily messaging limit only a day later, up to three days', () => {
    expect(delays('whatsapp', { limit: 'daily_messaging_limit' })).toEqual(Array(WHATSAPP_DAILY_LIMIT_RETRIES).fill(DAY_MS + 15 * 60_000));
  });

  it('counts both paths separately, so a mix stays bounded', () => {
    const spent = { quickRetries: QUICK_RETRY_LIMIT, deferredRetries: 1, dailyLimitRetries: 0 };
    expect(decideRetry('whatsapp', {}, spent, now, 0.5).kind).toBe('give_up');
    expect(decideRetry('whatsapp', { limit: 'daily_messaging_limit' }, spent, now, 0.5)).toMatchObject({ kind: 'retry', counters: { dailyLimitRetries: 1 } });
  });

  it('gives web push quick retries only', () => {
    expect(delays('web_push', {})).toHaveLength(WEB_PUSH_QUICK_RETRY_LIMIT);
    expect(Math.max(...delays('web_push', {}))).toBeLessThan(6 * 60 * 60 * 1000 + 1);
  });

  it('honours the provider hint and jitters by ±25 %', () => {
    expect(decideRetry('web_push', { retryAfterMs: 600_000 }, fresh, now, 0.5)).toMatchObject({ nextAttemptAt: new Date(now.getTime() + 600_000) });
    const low = decideRetry('whatsapp', {}, fresh, now, 0);
    const high = decideRetry('whatsapp', {}, fresh, now, 0.999_999);
    expect(low.kind === 'retry' && low.nextAttemptAt.getTime() - now.getTime()).toBe(45_000);
    expect(high.kind === 'retry' && high.nextAttemptAt.getTime() - now.getTime()).toBe(75_000);
  });

  it('pauses the channel 30 s doubling to 15 min, at least the provider hint', () => {
    expect([1, 2, 3, 10].map((n) => channelBackoffMs(n, null, 0.5))).toEqual([30_000, 60_000, 120_000, 900_000]);
    expect(channelBackoffMs(1, 120_000, 0.5)).toBe(120_000);
  });
});
