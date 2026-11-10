import type { DatabaseExecutor } from '@campuspilot/db';
import { isNotificationType, type RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, eq, lte, min, sql, type SQL } from 'drizzle-orm';

import type { DeliverySendOutcome, NotificationChannelAdapter } from '../channels';
import { claimDelivery, recordDeliveryOutcome, skipOwedDelivery } from '../deliveries';
import { disabledFeatureOf } from '../features';
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
 *
 * Bounded by the number of (priority, school) groups with owed rows, not by
 * the number of due rows: a recursive skip scan walks the groups through
 * `notification_delivery_queue_school_idx` (one index probe per group), and
 * each group contributes only its first `limit` due rows. That is exact: a
 * row in turn `limit + 1` or later of its school has at least `limit` rows
 * of the same priority before it, so it can never be among the first
 * `limit`. A group whose owed rows are all not yet due contributes nothing.
 */
export async function pickDueDeliveries(
  db: DatabaseExecutor,
  target: SenderTarget,
  options: { now: Date; limit: number } & SenderScope,
): Promise<string[]> {
  const school = (alias: SQL) => (options.schoolId ? sql` and ${alias}.school_id = ${options.schoolId}` : sql``);
  const owed = (alias: SQL) => sql`${alias}.status = 'owed' and ${alias}.channel = ${target.channel} and ${alias}.send_lane = ${target.lane}${school(alias)}`;
  const g = sql.raw('g');
  const d = sql.raw('d');
  const result = await db.execute<{ id: string }>(sql`
    with recursive groups as (
      (select ${d}.send_priority, ${d}.school_id from ${notificationDeliveryTable} ${d}
        where ${owed(d)}
        order by ${d}.send_priority, ${d}.school_id
        limit 1)
      union all
      select next_group.send_priority, next_group.school_id
      from groups ${g}
      cross join lateral (
        select ${d}.send_priority, ${d}.school_id from ${notificationDeliveryTable} ${d}
        where ${owed(d)} and (${d}.send_priority, ${d}.school_id) > (${g}.send_priority, ${g}.school_id)
        order by ${d}.send_priority, ${d}.school_id
        limit 1
      ) next_group
    )
    select picked.id
    from groups ${g}
    cross join lateral (
      select ${d}.id, ${d}.next_attempt_at, row_number() over (order by ${d}.next_attempt_at, ${d}.id) as turn
      from ${notificationDeliveryTable} ${d}
      where ${owed(d)}
        and ${d}.send_priority = ${g}.send_priority
        and ${d}.school_id = ${g}.school_id
        and ${d}.next_attempt_at <= ${options.now.toISOString()}::timestamptz
      order by ${d}.next_attempt_at, ${d}.id
      limit ${options.limit}
    ) picked
    order by ${g}.send_priority, picked.turn, picked.next_attempt_at, picked.id
    limit ${options.limit}
  `);
  return result.rows.map((row) => row.id);
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
 * Whether the delivery's notification type needs a platform feature its
 * school does not have right now. Read just before the claim, so a copy
 * planned while the feature was on is not sent after it was switched off.
 * A type that needs no feature (every type but notices) stops after the
 * one indexed read of its type.
 */
async function deliveryFeatureDisabled(db: DatabaseExecutor, deliveryId: string): Promise<boolean> {
  const [row] = await db
    .select({ schoolId: notificationDeliveryTable.schoolId, type: notificationTable.type })
    .from(notificationDeliveryTable)
    .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
    .where(eq(notificationDeliveryTable.id, deliveryId))
    .limit(1);
  if (!row || !isNotificationType(row.type)) return false;
  return (await disabledFeatureOf(db, row.schoolId, row.type)) !== null;
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
 * the delivery was planned records it `skipped: disabled` without a claim,
 * and one whose notification type lost a school feature it needs since then
 * (a notice copy still queued when `notices` was switched off) is recorded
 * `skipped: feature_disabled` the same way: nothing new goes out.
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
  if (await deliveryFeatureDisabled(db, deliveryId)) {
    return { kind: (await skipOwedDelivery(db, deliveryId, 'feature_disabled')) ? 'skipped' : 'not_owed', channelThrottle: null, outcomeUnknown: false, definiteAnswer: false };
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
