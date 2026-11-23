import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSlots, SLOT_WAIT_LIMIT_MS, SlotWaitTimeout } from './conversion-slots';

describe('document job slots', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the slot when the task fails (a step that Restate retries)', async () => {
    const slots = createSlots(1, 'test.wait');
    await expect(slots(async () => { throw new Error('Gotenberg 503'); })).rejects.toThrow('Gotenberg 503');
    expect(slots.usage()).toEqual({ active: 0, waiting: 0 });
    await expect(slots(async () => 'retried')).resolves.toBe('retried');
    expect(slots.usage()).toEqual({ active: 0, waiting: 0 });
  });

  it('hands a released slot to the oldest waiter, never to a newcomer', async () => {
    const slots = createSlots(1, 'test.wait');
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = slots(() => new Promise<void>((resolve) => { releaseFirst = resolve; }).then(() => { order.push('first'); }));
    const waiting = slots(async () => { order.push('waiter'); });
    await Promise.resolve();
    expect(slots.usage()).toEqual({ active: 1, waiting: 1 });
    releaseFirst();
    // A newcomer arriving as the slot is released queues behind the waiter.
    const newcomer = slots(async () => { order.push('newcomer'); });
    await Promise.all([first, waiting, newcomer]);
    expect(order).toEqual(['first', 'waiter', 'newcomer']);
    expect(slots.usage()).toEqual({ active: 0, waiting: 0 });
  });

  it('stops waiting when the attempt ends, and after the wait limit, leaving the queue', async () => {
    vi.useFakeTimers();
    const slots = createSlots(1, 'test.wait');
    let release!: () => void;
    const holder = slots(() => new Promise<void>((resolve) => { release = resolve; }));
    const attempt = new AbortController();
    const aborted = slots(async () => 'never', attempt.signal);
    const timedOut = slots(async () => 'never');
    expect(slots.usage().waiting).toBe(2);
    attempt.abort(new Error('attempt ended'));
    await expect(aborted).rejects.toThrow('attempt ended');
    vi.advanceTimersByTime(SLOT_WAIT_LIMIT_MS + 1);
    await expect(timedOut).rejects.toBeInstanceOf(SlotWaitTimeout);
    expect(slots.usage()).toEqual({ active: 1, waiting: 0 });
    release();
    await holder;
    expect(slots.usage()).toEqual({ active: 0, waiting: 0 });
  });
});
