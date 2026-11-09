import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import type { RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';
import { env } from '@campuspilot/env/server';

import { notificationChannelAdapters, type NotificationChannelAdapter } from '../channels';
import type { SenderTarget } from './lanes';
import { nextDueAt, pickDueDeliveries, sendDelivery, type SenderScope } from './queue';
import { channelBackoffMs } from './retry-policy';

/**
 * One drain of a sender lane (D-39), shared by the `NotificationSender`
 * Restate virtual object and the tests. Repeats: pick due deliveries
 * ({@link pickDueDeliveries}: priority, then round robin by school), send
 * them as one journaled group under the lane's rate and concurrency
 * limits, and pause the whole lane after a channel-wide throttle. When
 * nothing is due it sleeps until the next delivery is due if that is soon
 * ({@link MAX_IDLE_WAIT_MS}), else it ends; the API sweep pokes the lane
 * again once rows are due. After {@link MAX_GROUPS_PER_DRAIN} groups it ends
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

/** Runs one named unit of work; Restate journals it, tests call it directly. */
export type SenderStepRunner = <T>(name: string, action: () => Promise<T>) => Promise<T>;
/** Durable sleep; Restate's `ctx.sleep` in the object, a stub (or a fake clock) in tests. */
export type SenderSleep = (name: string, ms: number) => Promise<void>;

export type SenderDrainResult =
  | { status: 'idle'; sent: number; attempted: number; nextDueAt: string | null }
  | { status: 'continue'; sent: number; attempted: number };

type GroupResult = { attempted: number; sent: number; throttle: { retryAfterMs: number | null } | null };

/**
 * Sends the picked deliveries with at most `concurrency` in flight, starting
 * one every `1 / perSecond` seconds; stops starting new ones after a
 * channel-wide throttle (those stay owed, untouched). Returns no sooner than
 * the group's share of the rate, so back-to-back groups keep to it.
 */
async function sendGroup(
  ids: readonly string[],
  options: { target: SenderTarget; adapter: NotificationChannelAdapter; pacing: SenderPacing; db: DatabaseExecutor; clock: () => Date; random: () => number },
): Promise<GroupResult> {
  const intervalMs = 1000 / options.pacing.perSecond;
  const started = Date.now();
  let next = 0;
  let throttle: GroupResult['throttle'] = null;
  let attempted = 0;
  let sent = 0;
  const worker = async () => {
    for (let index = next++; index < ids.length && !throttle; index = next++) {
      const slot = started + index * intervalMs;
      const wait = slot - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (throttle) return;
      const result = await sendDelivery(options.db, ids[index]!, options.target.channel, options.adapter, { now: options.clock(), random: options.random });
      if (result.kind !== 'not_owed') attempted += 1;
      if (result.kind === 'sent') sent += 1;
      if (result.channelThrottle && !throttle) throttle = result.channelThrottle;
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.pacing.concurrency, ids.length) }, () => worker()));
  const remaining = started + ids.length * intervalMs - Date.now();
  if (!throttle && remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  return { attempted, sent, throttle };
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
  let throttles = 0;
  for (let group = 1; group <= MAX_GROUPS_PER_DRAIN; group += 1) {
    const picked = await step(`pick:${group}`, async () => {
      const now = clock();
      const ids = await pickDueDeliveries(db, target, { now, limit: pacing.groupSize, ...scope });
      if (ids.length > 0) return { ids, nextDueAt: null, waitMs: 0 };
      const next = await nextDueAt(db, target, scope);
      return { ids, nextDueAt: next?.toISOString() ?? null, waitMs: next ? Math.max(next.getTime() - now.getTime(), 0) : null };
    });
    if (picked.ids.length === 0) {
      if (picked.waitMs === null || picked.waitMs > MAX_IDLE_WAIT_MS) return { status: 'idle', sent, attempted, nextDueAt: picked.nextDueAt };
      await sleep(`idle:${group}`, Math.max(picked.waitMs, 1000));
      continue;
    }
    const result = await step(`send:${group}`, () => sendGroup(picked.ids, { target, adapter, pacing, db, clock, random }));
    sent += result.sent;
    attempted += result.attempted;
    if (!result.throttle) {
      throttles = 0;
      continue;
    }
    throttles += 1;
    const pauseMs = await step(`throttle:${group}`, async () => channelBackoffMs(throttles, result.throttle?.retryAfterMs, random()));
    await sleep(`pause:${group}`, pauseMs);
  }
  return { status: 'continue', sent, attempted };
}
