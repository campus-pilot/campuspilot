import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import type { RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';
import { env } from '@campuspilot/env/server';

import { notificationChannelAdapters, type NotificationChannelAdapter } from '../channels';
import { SENDER_POKE_WINDOW_MS, type SenderTarget } from './lanes';
import { nextDueAt, pickDueDeliveries, sendDelivery, type SendAttemptResult, type SenderScope } from './queue';
import { channelBackoffMs } from './retry-policy';
import { z } from 'zod';

/**
 * One drain of a sender lane (D-39), shared by the `NotificationSender`
 * Restate virtual object and the tests. Repeats: pick due deliveries
 * ({@link pickDueDeliveries}: priority, then round robin by school), send
 * them as one journaled group under the lane's rate and concurrency
 * limits, and pause the whole lane after a channel-wide throttle. When
 * nothing is due it sleeps until the next delivery is due if that is soon
 * ({@link MAX_IDLE_WAIT_MS}), else it ends; the API sweep pokes the lane
 * again once rows are due. Before ending it makes sure its last pick came
 * after the poke window it started in ({@link idleNotBeforeMs}), so a
 * fan-out poke folded into this drain's idempotency key is never lost. After {@link MAX_GROUPS_PER_DRAIN} groups it ends
 * with `continue`, and the object starts a fresh drain, so no journal grows
 * without bound.
 *
 * Determinism: every database read and write, every provider call, every
 * clock read and every random number happens inside a step; the loop only
 * branches on step results.
 */

/** Rate, concurrency and group size of one lane. */
export type SenderPacing = {
  /** Sends started per second (token bucket refill; the bucket holds one group). */
  perSecond: number;
  /** Sends in flight at once. */
  concurrency: number;
  /** Deliveries picked and sent per journaled step. */
  groupSize: number;
};

/** In-flight sends per lane: a modest cap, as asked for (D-39 chat: "max 10 at a time"). */
export const SENDER_CONCURRENCY = 10;
/**
 * In-flight sends while the lane is cautious: its unknown-outcome streak is
 * above 0 or the breaker is probing (see {@link sendGroup}). One at a time,
 * so a provider brownout that is already visible costs at most
 * {@link UNKNOWN_OUTCOME_BREAKER_THRESHOLD} unknown messages more instead
 * of a full {@link SENDER_CONCURRENCY} in flight. The sends already in
 * flight when the first unknown outcome arrives cannot be recalled: a
 * brownout that starts while the lane is at full concurrency still costs
 * up to {@link SENDER_CONCURRENCY} unknown messages before the breaker
 * trips.
 */
export const CAUTIOUS_SENDER_CONCURRENCY = 1;
/** A group is sized to about this much sending time, so a step stays short. */
const GROUP_SECONDS = 5;
const MAX_GROUP_SIZE = 50;

/** Pacing of a channel's lane from the platform environment (`*_SEND_RATE_PER_SECOND`). */
export function senderPacing(channel: RemoteNotificationChannel): SenderPacing {
  const perSecond = channel === 'whatsapp' ? env.WHATSAPP_SEND_RATE_PER_SECOND : env.WEB_PUSH_SEND_RATE_PER_SECOND;
  return {
    perSecond,
    concurrency: SENDER_CONCURRENCY,
    groupSize: Math.max(1, Math.min(MAX_GROUP_SIZE, Math.round(perSecond * GROUP_SECONDS))),
  };
}

/** Groups sent by one drain before it hands over to a fresh one. */
export const MAX_GROUPS_PER_DRAIN = 40;
/** Longest the drain sleeps waiting for the next due delivery; later ones are left to the sweep's poke. */
export const MAX_IDLE_WAIT_MS = 15_000;
/** Allowance for clock differences between the worker that poked and the one draining. */
export const POKE_WINDOW_MARGIN_MS = 2_000;

/**
 * When a drain that started at `startedAtMs` may end idle without losing a
 * poke: after the end of the poke window ({@link SENDER_POKE_WINDOW_MS}) it
 * started in, plus {@link POKE_WINDOW_MARGIN_MS}.
 *
 * Pokes share an idempotency key per lane and window, so a fan-out's poke
 * that arrives after this drain finished, in the window the drain was poked
 * in, is folded into this (completed) invocation and starts nothing. Every
 * such poke was sent in a window no later than the one this drain started
 * in (it was poked before it started), and the fan-out commits its rows
 * before poking. So a pick made after that window's end sees every row a
 * folded poke was meant for.
 */
export function idleNotBeforeMs(startedAtMs: number): number {
  return (Math.floor(startedAtMs / SENDER_POKE_WINDOW_MS) + 1) * SENDER_POKE_WINDOW_MS + POKE_WINDOW_MARGIN_MS;
}

/** Runs one named unit of work; Restate journals it, tests call it directly. */
export type SenderStepRunner = <T>(name: string, action: () => Promise<T>) => Promise<T>;
/** Durable sleep; Restate's `ctx.sleep` in the object, a stub (or a fake clock) in tests. */
export type SenderSleep = (name: string, ms: number) => Promise<void>;

/**
 * Consecutive sends whose outcome was unknown (a timeout or 5xx on the
 * message call, see the WhatsApp client) after which the lane's circuit
 * breaker trips: the lane pauses channel-wide with the same escalating
 * pause as a provider throttle ({@link channelBackoffMs}: 30 s doubling to
 * 15 min, jittered), then probes with single sends. A probe whose outcome
 * is unknown trips the breaker again (a longer pause). Only a probe the
 * provider answered definitively (`SendAttemptResult.definiteAnswer`: sent,
 * or accepted/rejected for a reason of its own) returns the lane to normal
 * groups; a probe that was throttled (pause, then probe again), not owed
 * any more, or failed before reaching the provider leaves the lane probing.
 * The unknown rows themselves stay `failed: outcome_unknown` (never retried
 * automatically); the breaker only stops a provider brownout from burning
 * the rest of the queue.
 *
 * The breaker state lives in the drain ({@link SenderLaneState}), not in
 * the database: it is handed to the next drain on a `continue` hand-over,
 * but a drain that ends idle, fails, or is killed (the API sweep kills a
 * `paused` drain, see `pokeDueSenders`) takes it along, and the next drain
 * starts with a closed breaker at full concurrency. During a brownout that
 * outlives a drain, each fresh drain can therefore spend up to
 * {@link SENDER_CONCURRENCY} unknown outcomes before tripping again. Not
 * persisted on purpose: a drain is killed only after Restate gave up on it
 * (a step failing past its retries), which is rare, and persisting it would
 * add a lane table whose rows must agree with the virtual object's journal.
 */
export const UNKNOWN_OUTCOME_BREAKER_THRESHOLD = 3;

/**
 * A lane's pause state, carried from one drain to the next when a long
 * backlog continues in a fresh invocation, so a brownout's escalation and
 * probe are not reset by the hand-over.
 */
export const senderLaneStateSchema = z.object({
  /** Unknown outcomes in a row (completion order), reset by any definite provider answer. */
  unknownStreak: z.number().int().min(0),
  /** Pauses in a row (throttle or breaker), for the escalation; reset by a group without either that left the breaker closed. */
  pauses: z.number().int().min(0),
  /** The breaker tripped and no probe got a definite provider answer yet: groups are single probe sends. */
  probing: z.boolean(),
});
export type SenderLaneState = z.infer<typeof senderLaneStateSchema>;
const INITIAL_LANE_STATE: SenderLaneState = { unknownStreak: 0, pauses: 0, probing: false };

export type SenderDrainResult =
  | { status: 'idle'; sent: number; attempted: number; breakerTrips: number; nextDueAt: string | null }
  | { status: 'continue'; sent: number; attempted: number; breakerTrips: number; state: SenderLaneState };

type GroupResult = {
  attempted: number;
  sent: number;
  throttle: { retryAfterMs: number | null } | null;
  /** Unknown outcomes in a row at the end of the group (carried into the next). */
  unknownStreak: number;
  /** The streak reached {@link UNKNOWN_OUTCOME_BREAKER_THRESHOLD}; no new send was started after that. */
  breakerTripped: boolean;
  /** Sends the provider answered definitively (`SendAttemptResult.definiteAnswer`); a probe group needs one to close the breaker. */
  definiteAnswers: number;
};

/** Sends one picked delivery; {@link sendDelivery} in production, injectable for tests. */
export type SendOne = (deliveryId: string) => Promise<SendAttemptResult>;

/**
 * Sends the picked deliveries with at most `concurrency` in flight (only
 * {@link CAUTIOUS_SENDER_CONCURRENCY} while the unknown-outcome streak is
 * above 0 or `probing` is set; the limit is re-checked before every start,
 * so the first unknown outcome in a group already holds back new sends
 * until those in flight have answered), starting
 * one every `1 / perSecond` seconds; stops starting new ones after a
 * channel-wide throttle (those stay owed, untouched). Returns no sooner than
 * the group's share of the rate, so back-to-back groups keep to it. It
 * also stops starting sends once {@link UNKNOWN_OUTCOME_BREAKER_THRESHOLD}
 * outcomes in a row were unknown (counting on from `unknownStreak`); sends
 * already in flight finish.
 *
 * A send that throws (database error) stops every worker from starting
 * another send, and the group rethrows the first error only once every
 * send already in flight has finished. So when Restate retries the failed
 * step, no send of the previous attempt is still running outside the
 * journal next to the retry's (a lane never has two senders).
 */
export async function sendGroup(
  ids: readonly string[],
  options: { pacing: SenderPacing; send: SendOne; unknownStreak?: number; probing?: boolean },
): Promise<GroupResult> {
  const intervalMs = 1000 / options.pacing.perSecond;
  const started = Date.now();
  let next = 0;
  let throttle: GroupResult['throttle'] = null;
  let failure: { error: unknown } | null = null;
  let attempted = 0;
  let sent = 0;
  let unknownStreak = options.unknownStreak ?? 0;
  let breakerTripped = false;
  let definiteAnswers = 0;
  let inFlight = 0;
  /** Workers waiting for an in-flight send to finish (cautious concurrency); woken after every send. */
  let waiting: (() => void)[] = [];
  const stopped = () => throttle !== null || failure !== null || breakerTripped;
  const concurrencyNow = () => (unknownStreak > 0 || options.probing ? CAUTIOUS_SENDER_CONCURRENCY : options.pacing.concurrency);
  const worker = async () => {
    for (let index = next++; index < ids.length && !stopped(); index = next++) {
      const slot = started + index * intervalMs;
      const wait = slot - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      while (!stopped() && inFlight >= concurrencyNow()) await new Promise<void>((resolve) => waiting.push(resolve));
      if (stopped()) return;
      inFlight += 1;
      let result: SendAttemptResult;
      try {
        result = await options.send(ids[index]!);
      } catch (error) {
        failure ??= { error };
        return;
      } finally {
        inFlight -= 1;
        const woken = waiting;
        waiting = [];
        for (const wake of woken) wake();
      }
      if (result.kind !== 'not_owed') attempted += 1;
      if (result.kind === 'sent') sent += 1;
      if (result.channelThrottle && !throttle) throttle = result.channelThrottle;
      // Only a definite provider answer ends a streak; a throttle, a failed
      // connection, a check before sending or a row not owed any more says
      // nothing about whether the provider works, so it neither extends nor ends it.
      if (result.outcomeUnknown) unknownStreak += 1;
      else if (result.definiteAnswer) {
        unknownStreak = 0;
        definiteAnswers += 1;
      }
      if (unknownStreak >= UNKNOWN_OUTCOME_BREAKER_THRESHOLD) breakerTripped = true;
    }
  };
  // Workers never reject (errors are caught above), so this waits for every one of them.
  await Promise.allSettled(Array.from({ length: Math.min(options.pacing.concurrency, ids.length) }, () => worker()));
  if (failure) throw (failure as { error: unknown }).error;
  const remaining = started + ids.length * intervalMs - Date.now();
  if (!throttle && !breakerTripped && remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  return { attempted, sent, throttle, unknownStreak, breakerTripped, definiteAnswers };
}

export async function runSenderDrain(options: {
  target: SenderTarget;
  step: SenderStepRunner;
  sleep: SenderSleep;
  adapters?: Record<RemoteNotificationChannel, NotificationChannelAdapter>;
  pacing?: SenderPacing;
  db?: DatabaseExecutor;
  /** The clock rows are due by; tests advance a fake one. */
  clock?: () => Date;
  random?: () => number;
  scope?: SenderScope;
  /** Pause state handed over by the previous drain of this lane (see {@link SenderLaneState}). */
  state?: SenderLaneState;
}): Promise<SenderDrainResult> {
  const { target, step, sleep } = options;
  const db = options.db ?? defaultDb;
  const adapter = (options.adapters ?? notificationChannelAdapters)[target.channel];
  const pacing = options.pacing ?? senderPacing(target.channel);
  const clock = options.clock ?? (() => new Date());
  const random = options.random ?? Math.random;
  const scope = options.scope ?? {};
  let sent = 0;
  let attempted = 0;
  let breakerTrips = 0;
  const state: SenderLaneState = { ...(options.state ?? INITIAL_LANE_STATE) };
  /** Set by the first pick: the drain may end idle only on a pick at or after it. */
  let idleNotBefore: number | null = null;
  /** The drain already slept until {@link idleNotBefore} once (a stubbed sleep in tests may not move the clock). */
  let settled = false;
  for (let group = 1; group <= MAX_GROUPS_PER_DRAIN; group += 1) {
    // A probe after the breaker tripped is a single send.
    const limit = state.probing ? 1 : pacing.groupSize;
    const picked = await step(`pick:${group}`, async () => {
      const now = clock();
      const nowMs = now.getTime();
      const ids = await pickDueDeliveries(db, target, { now, limit, ...scope });
      if (ids.length > 0) return { nowMs, ids, nextDueAt: null, waitMs: 0 };
      const next = await nextDueAt(db, target, scope);
      return { nowMs, ids, nextDueAt: next?.toISOString() ?? null, waitMs: next ? Math.max(next.getTime() - nowMs, 0) : null };
    });
    idleNotBefore ??= idleNotBeforeMs(picked.nowMs);
    if (picked.ids.length === 0) {
      if (picked.waitMs === null || picked.waitMs > MAX_IDLE_WAIT_MS) {
        if (!settled && picked.nowMs < idleNotBefore) {
          settled = true;
          await sleep(`settle:${group}`, idleNotBefore - picked.nowMs);
          continue;
        }
        return { status: 'idle', sent, attempted, breakerTrips, nextDueAt: picked.nextDueAt };
      }
      await sleep(`idle:${group}`, Math.max(picked.waitMs, 1000));
      continue;
    }
    const send: SendOne = (id) => sendDelivery(db, id, target.channel, adapter, { now: clock(), random });
    const probing = state.probing;
    const result = await step(`send:${group}`, () => sendGroup(picked.ids, { pacing, send, unknownStreak: state.unknownStreak, probing }));
    sent += result.sent;
    attempted += result.attempted;
    state.unknownStreak = result.unknownStreak;
    // A probe closes the breaker only on a definite provider answer.
    if (result.definiteAnswers > 0) state.probing = false;
    if (!result.throttle && !result.breakerTripped) {
      // A probe left without a definite answer keeps the escalation: the brownout is not known to be over.
      if (!state.probing) state.pauses = 0;
      continue;
    }
    state.pauses += 1;
    if (result.breakerTripped) {
      breakerTrips += 1;
      // One more unknown outcome (the probe's) trips it again.
      state.probing = true;
      state.unknownStreak = UNKNOWN_OUTCOME_BREAKER_THRESHOLD - 1;
    }
    const pauses = state.pauses;
    const pauseMs = await step(`throttle:${group}`, async () => channelBackoffMs(pauses, result.throttle?.retryAfterMs, random()));
    await sleep(`pause:${group}`, pauseMs);
  }
  return { status: 'continue', sent, attempted, breakerTrips, state };
}
