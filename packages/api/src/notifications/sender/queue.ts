import type { DatabaseExecutor } from '@campuspilot/db';
import type { RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable } from '@campuspilot/db/schema/notification';
import { and, asc, eq, lte, min, sql, type SQL } from 'drizzle-orm';

import type { DeliverySendOutcome, NotificationChannelAdapter } from '../channels';
import { claimDelivery, recordDeliveryOutcome, skipOwedDelivery } from '../deliveries';
import type { SenderTarget } from './lanes';

/**
 * The send queue is `notification_delivery` itself (D-39): `owed` rows
 * with a `next_attempt_at`. These are the queue's reads and the one-row
 * send the channel senders run.
 */

/** Restricts a sender's reads to one school. Only tests use it, to drain their own rows of a shared database. */
export type SenderScope = { schoolId?: string };

function laneWhere(target: SenderTarget, scope: SenderScope): SQL {
  return and(
    eq(notificationDeliveryTable.status, 'owed'),
    eq(notificationDeliveryTable.channel, target.channel),
    eq(notificationDeliveryTable.sendLane, target.lane),
    scope.schoolId ? eq(notificationDeliveryTable.schoolId, scope.schoolId) : undefined,
  )!;
}

/**
 * Up to `limit` deliveries of a lane due at `now`, in send order:
 * `immediate` before `bulk`, then round robin across schools (each school's
 * first due row, then each school's second, …), oldest due first within a
 * turn. So a school posting 5,000 bills delays another school's receipt by
 * at most one turn, never by the whole batch.
 */
export async function pickDueDeliveries(
  db: DatabaseExecutor,
  target: SenderTarget,
  options: { now: Date; limit: number } & SenderScope,
): Promise<string[]> {
  const table = notificationDeliveryTable;
  const due = db
    .select({
      id: table.id,
      priority: table.sendPriority,
      nextAttemptAt: table.nextAttemptAt,
      turn: sql<number>`row_number() over (partition by ${table.sendPriority}, ${table.schoolId} order by ${table.nextAttemptAt}, ${table.id})`.as('turn'),
    })
    .from(table)
    .where(and(laneWhere(target, options), lte(table.nextAttemptAt, options.now)))
    .as('due');
  const rows = await db
    .select({ id: due.id })
    .from(due)
    .orderBy(asc(due.priority), asc(due.turn), asc(due.nextAttemptAt), asc(due.id))
    .limit(options.limit);
  return rows.map((row) => row.id);
}

/** When the lane's next owed delivery is due; null when nothing is owed. */
export async function nextDueAt(db: DatabaseExecutor, target: SenderTarget, scope: SenderScope = {}): Promise<Date | null> {
  const [row] = await db.select({ at: min(notificationDeliveryTable.nextAttemptAt) }).from(notificationDeliveryTable).where(laneWhere(target, scope));
  return row?.at ?? null;
}

/** Every lane that has a delivery due at `now` (for the API sweep's pokes). */
export async function dueSenderTargets(db: DatabaseExecutor, now: Date = new Date()): Promise<SenderTarget[]> {
  const rows = await db
    .selectDistinct({ channel: notificationDeliveryTable.channel, lane: notificationDeliveryTable.sendLane })
    .from(notificationDeliveryTable)
    .where(and(eq(notificationDeliveryTable.status, 'owed'), lte(notificationDeliveryTable.nextAttemptAt, now)));
  return rows.map((row) => ({ channel: row.channel, lane: row.lane }));
}

/**
 * What one send attempt did; JSON-only so it can be journaled. `retry`
 * means rescheduled. `channelThrottle` is set whenever the provider
 * throttled the whole channel (even when this delivery's retries ran out),
 * so the sender pauses the channel.
 */
export type SendAttemptResult = {
  kind: 'sent' | 'failed' | 'skipped' | 'not_owed' | 'retry';
  channelThrottle: { retryAfterMs: number | null } | null;
  /** The provider's answer left open whether the message went out (feeds the lane's circuit breaker). */
  outcomeUnknown: boolean;
  /**
   * The provider definitively accepted or rejected the message (`sent`, or
   * the adapter's `definiteAnswer`, see `DefiniteAnswer` in the channel
   * types). Only such an answer resets the lane's unknown-outcome streak or
   * ends a breaker probe; a throttle, a failed connection or a check that
   * failed before any request says nothing about whether the provider
   * works again.
   */
  definiteAnswer: boolean;
};

/**
 * Claims, sends and records one due delivery (claim before send, D-25). A
 * delivery no longer owed or not yet due (already sent, stuck in `sending`
 * after a crash, rescheduled) is left alone. A channel switched off since
 * the delivery was planned records it `skipped: disabled` without a claim.
 * An adapter that throws is treated as a transient failure of this
 * delivery before the provider call (adapters classify every provider
 * answer themselves and must not throw after a request may have been
 * accepted), so a bug never leaves the delivery in `sending`. It is
 * recipient-scoped: the delivery's own bounded retries apply and the lane
 * keeps sending others. Only provider throttling and transport failures the
 * adapter classified as `channel` pause the whole lane, since a throw (a
 * document that fails to render, a bug in one notification type) says
 * nothing about the provider.
 */
export async function sendDelivery(
  db: DatabaseExecutor,
  deliveryId: string,
  channel: RemoteNotificationChannel,
  adapter: NotificationChannelAdapter,
  options: { now?: Date; random?: () => number } = {},
): Promise<SendAttemptResult> {
  if (!adapter.available) {
    return { kind: (await skipOwedDelivery(db, deliveryId, 'disabled')) ? 'skipped' : 'not_owed', channelThrottle: null, outcomeUnknown: false, definiteAnswer: false };
  }
  const claimed = await claimDelivery(db, deliveryId, options.now);
  if (!claimed) return { kind: 'not_owed', channelThrottle: null, outcomeUnknown: false, definiteAnswer: false };
  if (claimed.channel !== channel) throw new Error('A sender claimed a delivery of another channel.');
  let outcome: DeliverySendOutcome;
  try {
    outcome = await adapter.send(claimed);
  } catch {
    outcome = { kind: 'retry', errorCode: 'adapter_error', scope: 'recipient', definiteAnswer: false };
  }
  const recorded = await recordDeliveryOutcome(db, claimed, outcome, { now: options.now, random: options.random });
  const channelThrottle = outcome.kind === 'retry' && outcome.scope === 'channel' ? { retryAfterMs: outcome.retryAfterMs ?? null } : null;
  const definiteAnswer = outcome.kind === 'sent' || ((outcome.kind === 'failed' || outcome.kind === 'retry') && outcome.definiteAnswer);
  return { kind: recorded.kind, channelThrottle, outcomeUnknown: outcome.kind === 'failed' && outcome.outcomeUnknown === true, definiteAnswer };
}
