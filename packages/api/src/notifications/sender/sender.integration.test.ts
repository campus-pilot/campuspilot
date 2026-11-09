import { db } from '@campuspilot/db';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestAdmission, createTestSchool } from '../../../test/fixtures';
import { billIssuedData, dispatchNow, emit, fakeClock, TEST_PACING } from '../../../test/notifications';
import type { ClaimedDelivery, NotificationChannelAdapter } from '../channels';
import { claimDelivery } from '../deliveries';
import { CAUTIOUS_SENDER_CONCURRENCY, idleNotBeforeMs, MAX_GROUPS_PER_DRAIN, POKE_WINDOW_MARGIN_MS, runSenderDrain, sendGroup, UNKNOWN_OUTCOME_BREAKER_THRESHOLD } from './drain';
import { SENDER_POKE_WINDOW_MS } from './lanes';
import type { SenderTarget } from './lanes';
import { pickDueDeliveries, type SendAttemptResult } from './queue';

const whatsappOff = { channel: 'whatsapp', available: false, unavailableReason: 'test' } as const;

/**
 * Queues `copies` owed web push copies for one student of a new school, on
 * the given test lane (see {@link uniqueLane}), so the lane can be drained
 * and picked without a school scope.
 */
async function queue(options: { lane: number; copies: number; sendPriority: 'immediate' | 'bulk'; schoolId?: string }) {
  const schoolId = options.schoolId ?? (await createTestSchool()).id;
  const admission = await createTestAdmission({ schoolId });
  const adapter: NotificationChannelAdapter = {
    channel: 'web_push',
    available: true,
    decide: () => Array.from({ length: options.copies }, (_, index) => ({ status: 'owed' as const, destination: `sub_${index}` })),
    send: vi.fn(),
  };
  const { eventId } = await emit({ type: 'bill.issued', data: billIssuedData(admission.id), schoolId, recipients: { kind: 'admissions', admissionIds: [admission.id] }, sendPriority: options.sendPriority });
  await dispatchNow(eventId, { web_push: adapter, whatsapp: whatsappOff });
  const notifications = await db.select({ id: notificationTable.id }).from(notificationTable).where(eq(notificationTable.eventId, eventId));
  const rows = await db
    .update(notificationDeliveryTable)
    .set({ sendLane: options.lane })
    .where(and(inArray(notificationDeliveryTable.notificationId, notifications.map((row) => row.id)), eq(notificationDeliveryTable.channel, 'web_push')))
    .returning({ id: notificationDeliveryTable.id });
  return { schoolId, ids: rows.map((row) => row.id).sort() };
}

/**
 * First lane number handed to a test. Production web push lanes are
 * `0..WEB_PUSH_SENDER_LANES - 1` and no other test file moves rows onto a
 * lane at or above this, so these lanes belong to this file alone.
 */
const FIRST_TEST_LANE = 100;
let nextTestLane = FIRST_TEST_LANE;
const usedLanes: number[] = [];

/**
 * A lane no other test of this run has used: a counter, not a random number,
 * so two tests can never share one (the test database is created fresh for
 * every run, see `test/global-setup.ts`). Each test's rows are also deleted
 * after it ({@link afterEach} below), so even an unscoped drain or pick only
 * ever sees the rows its own test queued.
 */
const uniqueLane = (): SenderTarget => {
  const lane = nextTestLane++;
  usedLanes.push(lane);
  return { channel: 'web_push', lane };
};

afterEach(async () => {
  const lanes = usedLanes.splice(0);
  if (lanes.length === 0) return;
  await db.delete(notificationDeliveryTable).where(and(eq(notificationDeliveryTable.channel, 'web_push'), inArray(notificationDeliveryTable.sendLane, lanes)));
});

function recordingAdapter(sent: string[]): NotificationChannelAdapter {
  return {
    channel: 'web_push',
    available: true,
    decide: () => [],
    send: async (delivery: ClaimedDelivery) => {
      sent.push(delivery.id);
      return { kind: 'sent', providerMessageId: null };
    },
  };
}

describe('notification sender (D-39)', () => {
  it('picks immediate copies first, then takes turns across schools', async () => {
    const target = uniqueLane();
    const big = await queue({ lane: target.lane, copies: 3, sendPriority: 'bulk' });
    const small = await queue({ lane: target.lane, copies: 1, sendPriority: 'bulk' });
    const receipt = await queue({ lane: target.lane, copies: 1, sendPriority: 'immediate', schoolId: big.schoolId });
    const picked = await pickDueDeliveries(db, target, { now: new Date(), limit: 10 });
    expect(picked).toHaveLength(5);
    expect(picked[0]).toBe(receipt.ids[0]);
    // Turn 1: one of each school's bulk copies; then the big school's rest.
    expect(picked.slice(1, 3)).toContain(small.ids[0]);
    expect(picked.slice(1, 3).filter((id) => big.ids.includes(id))).toHaveLength(1);
    expect(picked.slice(3).every((id) => big.ids.includes(id))).toBe(true);
  });

  it('sends every due copy once, never a stuck `sending` one or one not yet due', async () => {
    const target = uniqueLane();
    const { ids } = await queue({ lane: target.lane, copies: 4, sendPriority: 'bulk' });
    const [stuck, later] = ids;
    await db.update(notificationDeliveryTable).set({ status: 'sending', nextAttemptAt: null, claimedAt: new Date() }).where(eq(notificationDeliveryTable.id, stuck!));
    const clock = fakeClock();
    const laterDue = new Date(clock.now().getTime() + 10 * 60_000);
    await db.update(notificationDeliveryTable).set({ nextAttemptAt: laterDue }).where(eq(notificationDeliveryTable.id, later!));
    const sent: string[] = [];
    const result = await runSenderDrain({ target, step: (_name, action) => action(), sleep: async (_name, ms) => clock.advance(ms), clock: clock.now, adapters: { web_push: recordingAdapter(sent), whatsapp: whatsappOff }, pacing: TEST_PACING, random: () => 0.5 });
    expect(sent.sort()).toEqual(ids.slice(2).sort());
    expect(result).toMatchObject({ status: 'idle', sent: 2 });
    // The next copy is ten minutes out: the drain ends and leaves it to the sweep's poke.
    expect(result.status === 'idle' && new Date(result.nextDueAt!).getTime()).toBe(laterDue.getTime());
    const rows = await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.id, ids)).orderBy(asc(notificationDeliveryTable.id));
    expect(rows.find((row) => row.id === stuck)).toMatchObject({ status: 'sending', attempts: 0 });
    expect(rows.find((row) => row.id === later)).toMatchObject({ status: 'owed', attempts: 0 });
  });

  it('waits for a copy due within seconds instead of ending', async () => {
    const target = uniqueLane();
    const { ids } = await queue({ lane: target.lane, copies: 1, sendPriority: 'immediate' });
    const clock = fakeClock();
    await db.update(notificationDeliveryTable).set({ nextAttemptAt: new Date(clock.now().getTime() + 5_000) }).where(eq(notificationDeliveryTable.id, ids[0]!));
    const sleeps: number[] = [];
    const sent: string[] = [];
    const result = await runSenderDrain({ target, step: (_name, action) => action(), sleep: async (name, ms) => { if (name.startsWith('idle:')) sleeps.push(ms); clock.advance(ms); }, clock: clock.now, adapters: { web_push: recordingAdapter(sent), whatsapp: whatsappOff }, pacing: TEST_PACING });
    expect(sleeps).toEqual([5_000]);
    expect(sent).toEqual(ids);
    expect(result).toMatchObject({ status: 'idle', nextDueAt: null });
  });

  it('hands a long backlog over to a fresh drain after a bounded number of groups', async () => {
    const target = uniqueLane();
    const { ids } = await queue({ lane: target.lane, copies: MAX_GROUPS_PER_DRAIN + 2, sendPriority: 'bulk' });
    const sent: string[] = [];
    const names: string[] = [];
    const step = <T,>(name: string, action: () => Promise<T>) => {
      names.push(name);
      return action();
    };
    const adapters = { web_push: recordingAdapter(sent), whatsapp: whatsappOff };
    const pacing = { ...TEST_PACING, groupSize: 1 };
    expect(await runSenderDrain({ target, step, sleep: async () => undefined, adapters, pacing })).toMatchObject({ status: 'continue', sent: MAX_GROUPS_PER_DRAIN });
    expect(names.filter((name) => name.startsWith('send:'))).toHaveLength(MAX_GROUPS_PER_DRAIN);
    expect(await runSenderDrain({ target, step, sleep: async () => undefined, adapters, pacing })).toMatchObject({ status: 'idle', sent: 2 });
    expect(sent.sort()).toEqual(ids);
  });

  it('records copies of a channel switched off since fan-out as skipped: disabled', async () => {
    const target = uniqueLane();
    const { ids } = await queue({ lane: target.lane, copies: 2, sendPriority: 'bulk' });
    const off = { channel: 'web_push', available: false, unavailableReason: 'off' } as const;
    await runSenderDrain({ target, step: (_name, action) => action(), sleep: async () => undefined, adapters: { web_push: off, whatsapp: whatsappOff }, pacing: TEST_PACING });
    const rows = await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.id, ids));
    expect(rows.map((row) => [row.status, row.skipReason, row.nextAttemptAt])).toEqual([
      ['skipped', 'disabled', null],
      ['skipped', 'disabled', null],
    ]);
  });

  it('keeps to the rate: a group of n takes at least n / rate seconds', async () => {
    const target = uniqueLane();
    await queue({ lane: target.lane, copies: 5, sendPriority: 'bulk' });
    const sent: string[] = [];
    const started = Date.now();
    await runSenderDrain({ target, step: (_name, action) => action(), sleep: async () => undefined, adapters: { web_push: recordingAdapter(sent), whatsapp: whatsappOff }, pacing: { perSecond: 20, concurrency: 10, groupSize: 5 } });
    expect(sent).toHaveLength(5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
  });

  it('waits for every send in flight before a failed group rethrows, and starts no new send after the failure', async () => {
    const started: string[] = [];
    const finished: string[] = [];
    const send = async (id: string): Promise<SendAttemptResult> => {
      started.push(id);
      if (id === 'a') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('database down');
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
      finished.push(id);
      return { kind: 'sent', channelThrottle: null, outcomeUnknown: false, definiteAnswer: true };
    };
    await expect(sendGroup(['a', 'b', 'c', 'd', 'e'], { pacing: { perSecond: 1000, concurrency: 3, groupSize: 5 }, send })).rejects.toThrow('database down');
    // b and c were in flight when a failed: the group returned only after both finished.
    expect(finished.sort()).toEqual(['b', 'c']);
    expect(started.sort()).toEqual(['a', 'b', 'c']);
  });

  it('retries a delivery whose adapter throws on its own, without pausing the lane', async () => {
    const target = uniqueLane();
    const { ids } = await queue({ lane: target.lane, copies: 2, sendPriority: 'bulk' });
    const sent: string[] = [];
    const adapter: NotificationChannelAdapter = {
      channel: 'web_push',
      available: true,
      decide: () => [],
      send: async (delivery) => {
        if (delivery.id === ids[0]) throw new Error('render bug');
        sent.push(delivery.id);
        return { kind: 'sent', providerMessageId: null };
      },
    };
    const names: string[] = [];
    const clock = fakeClock();
    await runSenderDrain({ target, step: (name, action) => { names.push(name); return action(); }, sleep: async (_name, ms) => clock.advance(ms), clock: clock.now, adapters: { web_push: adapter, whatsapp: whatsappOff }, pacing: TEST_PACING, random: () => 0.5 });
    expect(sent).toEqual([ids[1]]);
    expect(names.some((name) => name.startsWith('throttle:') || name.startsWith('pause:'))).toBe(false);
    const [row] = await db.select().from(notificationDeliveryTable).where(eq(notificationDeliveryTable.id, ids[0]!));
    expect(row).toMatchObject({ status: 'owed', errorCode: 'adapter_error', quickRetries: 1 });
  });

  it('claims a delivery and reads its notification in one statement', async () => {
    const target = uniqueLane();
    const { ids } = await queue({ lane: target.lane, copies: 1, sendPriority: 'bulk' });
    const claimed = await claimDelivery(db, ids[0]!);
    expect(claimed).toMatchObject({ id: ids[0], channel: 'web_push', type: 'bill.issued', retries: { quickRetries: 0, deferredRetries: 0, dailyLimitRetries: 0 } });
    expect(claimed?.admissionId).toEqual(expect.any(String));
    expect(claimed?.data).toMatchObject({ billNumber: expect.any(String) });
    expect(await claimDelivery(db, ids[0]!)).toBeNull();
  });

  it('trips the circuit breaker after consecutive unknown outcomes, pauses the lane, then probes with one send', async () => {
    expect(UNKNOWN_OUTCOME_BREAKER_THRESHOLD).toBe(3);
    const target = uniqueLane();
    const { ids } = await queue({ lane: target.lane, copies: 6, sendPriority: 'bulk' });
    let calls = 0;
    const adapter: NotificationChannelAdapter = {
      channel: 'web_push',
      available: true,
      decide: () => [],
      // A brownout: the first four sends time out after sending, then the provider recovers.
      send: async () => {
        calls += 1;
        return calls <= 4
          ? { kind: 'failed', errorCode: 'outcome_unknown', errorMessage: 'unknown', outcomeUnknown: true, definiteAnswer: false }
          : { kind: 'sent', providerMessageId: null };
      },
    };
    const clock = fakeClock();
    const pauses: number[] = [];
    const sendGroups: string[] = [];
    const result = await runSenderDrain({
      target,
      step: async (name, action) => {
        const value = await action();
        if (name.startsWith('send:')) sendGroups.push(name);
        return value;
      },
      sleep: async (name, ms) => {
        if (name.startsWith('pause:')) pauses.push(ms);
        clock.advance(ms);
      },
      clock: clock.now,
      adapters: { web_push: adapter, whatsapp: whatsappOff },
      pacing: TEST_PACING,
      random: () => 0.5,
    });
    // Three unknowns trip it (30 s pause); the probe is unknown too (60 s pause); the next probe succeeds and the rest go out.
    expect(pauses).toEqual([30_000, 60_000]);
    expect(sendGroups).toHaveLength(4);
    expect(result).toMatchObject({ breakerTrips: 2, sent: 2, attempted: 6 });
    const rows = await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.id, ids));
    expect(rows.filter((row) => row.status === 'failed')).toHaveLength(4);
    expect(rows.filter((row) => row.status === 'sent')).toHaveLength(2);
  });

  it('stops starting sends in a group once the unknown-outcome streak reaches the threshold', async () => {
    const started: string[] = [];
    const send = async (id: string): Promise<SendAttemptResult> => {
      started.push(id);
      return { kind: 'failed', channelThrottle: null, outcomeUnknown: true, definiteAnswer: false };
    };
    const result = await sendGroup(['a', 'b', 'c', 'd'], { pacing: { perSecond: 1000, concurrency: 1, groupSize: 4 }, send, unknownStreak: 1 });
    expect(started).toEqual(['a', 'b']);
    expect(result).toMatchObject({ breakerTripped: true, unknownStreak: 3, attempted: 2 });
  });

  it('keeps probing after a throttled probe and closes the breaker only on a definite provider answer', async () => {
    const target = uniqueLane();
    await queue({ lane: target.lane, copies: 6, sendPriority: 'bulk' });
    let calls = 0;
    const adapter: NotificationChannelAdapter = {
      channel: 'web_push',
      available: true,
      decide: () => [],
      // Three unknowns trip the breaker; the first probe is throttled, the second is accepted.
      send: async () => {
        calls += 1;
        if (calls <= 3) return { kind: 'failed', errorCode: 'outcome_unknown', outcomeUnknown: true, definiteAnswer: false };
        if (calls === 4) return { kind: 'retry', errorCode: 'http_429', scope: 'channel', definiteAnswer: false, retryAfterMs: 1_000 };
        return { kind: 'sent', providerMessageId: null };
      },
    };
    const clock = fakeClock();
    const pickSizes: number[] = [];
    const pauses: number[] = [];
    const result = await runSenderDrain({
      target,
      step: async (name, action) => {
        const value = await action();
        if (name.startsWith('pick:')) pickSizes.push((value as { ids: string[] }).ids.length);
        return value;
      },
      sleep: async (name, ms) => {
        if (name.startsWith('pause:')) pauses.push(ms);
        clock.advance(ms);
      },
      clock: clock.now,
      adapters: { web_push: adapter, whatsapp: whatsappOff },
      pacing: TEST_PACING,
      random: () => 0.5,
    });
    // Trip (30 s), throttled probe (60 s, escalated), a second single probe, then a normal group.
    expect(pauses).toEqual([30_000, 60_000]);
    expect(pickSizes.slice(0, 3)).toEqual([6, 1, 1]);
    expect(pickSizes[3]).toBeGreaterThan(1);
    expect(result).toMatchObject({ breakerTrips: 1, sent: 3 });
  });

  it('keeps probing when the probe was not owed any more (no provider answer)', async () => {
    const outcomes: SendAttemptResult[] = [
      { kind: 'not_owed', channelThrottle: null, outcomeUnknown: false, definiteAnswer: false },
    ];
    const result = await sendGroup(['a'], { pacing: TEST_PACING, send: async () => outcomes.shift()!, unknownStreak: UNKNOWN_OUTCOME_BREAKER_THRESHOLD - 1, probing: true });
    expect(result).toMatchObject({ definiteAnswers: 0, breakerTripped: false, unknownStreak: UNKNOWN_OUTCOME_BREAKER_THRESHOLD - 1 });
  });

  it('sends one at a time while the unknown-outcome streak is above 0, so a brownout costs only the threshold', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: string[] = [];
    const send = async (id: string): Promise<SendAttemptResult> => {
      started.push(id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { kind: 'failed', channelThrottle: null, outcomeUnknown: true, definiteAnswer: false };
    };
    const ids = Array.from({ length: 12 }, (_, index) => `d${index}`);
    const result = await sendGroup(ids, { pacing: { perSecond: 1000, concurrency: 10, groupSize: 12 }, send, unknownStreak: 1 });
    // At full concurrency all ten would have been in flight before the first answer.
    expect(maxInFlight).toBe(CAUTIOUS_SENDER_CONCURRENCY);
    expect(started).toHaveLength(UNKNOWN_OUTCOME_BREAKER_THRESHOLD - 1);
    expect(result).toMatchObject({ breakerTripped: true, attempted: UNKNOWN_OUTCOME_BREAKER_THRESHOLD - 1 });
  });

  it('sends one at a time while probing and returns to full concurrency after a definite answer', async () => {
    let inFlight = 0;
    const inFlightAtStart: number[] = [];
    const send = async (): Promise<SendAttemptResult> => {
      inFlight += 1;
      inFlightAtStart.push(inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { kind: 'sent', channelThrottle: null, outcomeUnknown: false, definiteAnswer: true };
    };
    const ids = Array.from({ length: 12 }, (_, index) => `d${index}`);
    expect(await sendGroup(ids.slice(0, 3), { pacing: { perSecond: 1000, concurrency: 10, groupSize: 3 }, send, probing: true })).toMatchObject({ sent: 3, definiteAnswers: 3 });
    expect(Math.max(...inFlightAtStart)).toBe(1);
    inFlightAtStart.length = 0;
    // A streak above 0 holds back the second send until the first answered (definitely); then the rest go out in parallel.
    expect(await sendGroup(ids, { pacing: { perSecond: 1000, concurrency: 10, groupSize: 12 }, send, unknownStreak: 2 })).toMatchObject({ sent: 12, unknownStreak: 0 });
    expect(inFlightAtStart[0]).toBe(1);
    expect(inFlightAtStart[1]).toBe(1);
    expect(Math.max(...inFlightAtStart)).toBeGreaterThan(CAUTIOUS_SENDER_CONCURRENCY);
  });

  it('before ending idle, picks once more after the poke window it started in (a folded poke is not lost)', async () => {
    const target = uniqueLane();
    const { ids } = await queue({ lane: target.lane, copies: 2, sendPriority: 'immediate' });
    const [first, folded] = ids;
    // Start 3 s into a window that begins after the rows were created, so they are due.
    const windowStart = (Math.floor(Date.now() / SENDER_POKE_WINDOW_MS) + 1) * SENDER_POKE_WINDOW_MS;
    const clock = fakeClock(new Date(windowStart + 3_000));
    // The second copy is not owed yet: it stands for a fan-out that commits and pokes while this drain runs.
    await db.update(notificationDeliveryTable).set({ nextAttemptAt: new Date(windowStart + 60 * 60_000) }).where(eq(notificationDeliveryTable.id, folded!));
    const sent: string[] = [];
    const settles: number[] = [];
    const result = await runSenderDrain({
      target,
      step: (_name, action) => action(),
      sleep: async (name, ms) => {
        if (name.startsWith('settle:')) {
          settles.push(ms);
          // Meanwhile the fan-out commits its row and pokes; the poke is folded into this drain's key.
          await db.update(notificationDeliveryTable).set({ nextAttemptAt: clock.now() }).where(eq(notificationDeliveryTable.id, folded!));
        }
        clock.advance(ms);
      },
      clock: clock.now,
      adapters: { web_push: recordingAdapter(sent), whatsapp: whatsappOff },
      pacing: TEST_PACING,
    });
    expect(idleNotBeforeMs(windowStart + 3_000)).toBe(windowStart + SENDER_POKE_WINDOW_MS + POKE_WINDOW_MARGIN_MS);
    expect(settles).toEqual([SENDER_POKE_WINDOW_MS - 3_000 + POKE_WINDOW_MARGIN_MS]);
    expect(sent).toEqual([first, folded]);
    expect(result).toMatchObject({ status: 'idle', sent: 2 });
  });
});
