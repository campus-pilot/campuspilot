import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import {
  isNotificationType,
  notificationCatalogue,
  notificationRecipientSpecSchema,
  RECIPIENT_SPEC_KIND_BY_AUDIENCE,
  REMOTE_NOTIFICATION_CHANNELS,
  type NotificationType,
  type RemoteNotificationChannel,
} from '@campuspilot/db/notifications/catalogue';
import { admissionTable } from '@campuspilot/db/schema/admission';
import {
  notificationDeliveryTable,
  notificationEventTable,
  notificationTable,
} from '@campuspilot/db/schema/notification';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolTable } from '@campuspilot/db/schema/school';
import { and, eq, inArray } from 'drizzle-orm';

import {
  decideDeliveries,
  notificationChannelAdapters,
  type DeliveryDecision,
  type NotificationChannelAdapter,
  type NotificationSkipReason,
  type ResolvedRecipient,
} from './channels';
import { activePushSubscriptionIdsByAdmission } from './channels/web-push/subscriptions';
import { notificationDeliveryId, notificationRedeliveryId, notificationRowId } from './ids';
import type { NotificationSendPriority } from './notify';
import { senderLaneFor, uniqueSenderTargets, type SenderTarget } from './sender/lanes';

/**
 * The notification dispatcher (D-23 … D-26): everything between an outbox
 * event and its rows. It is the one place that resolves recipients, decides
 * channels and writes `notification` / `notification_delivery` rows. The
 * `NotificationDispatch` Restate workflow runs {@link runNotificationDispatch}
 * with journaled steps; tests run it with plain calls.
 */

/** Notifications (with their deliveries) written per transaction. */
export const NOTIFICATION_INSERT_CHUNK = 200;

/** A deterministic failure whose message is safe to record on the event. */
export class NotificationDispatchError extends Error {
  override name = 'NotificationDispatchError';
}

/** The event as the dispatcher needs it; JSON-only so it can be journaled. */
export type DispatchableEvent = {
  id: string;
  schoolId: string;
  isDemoSchool: boolean;
  type: NotificationType;
  data: Record<string, unknown>;
  recipients: ReturnType<typeof notificationRecipientSpecSchema.parse>;
  /** Copied onto every delivery row: the senders send `immediate` before `bulk`. */
  sendPriority: NotificationSendPriority;
  /**
   * Set for a staff resend of one failed delivery: the fan-out writes no
   * inbox row, only a new delivery of that notification on that channel.
   */
  redeliveryOf: {
    deliveryId: string;
    notificationId: string;
    channel: RemoteNotificationChannel;
    /** The original copy's destination; a web push resend goes to that subscription only (D-40). */
    destination: string | null;
  } | null;
};

/**
 * Loads a pending event. Null when it no longer needs dispatching: it was
 * already dispatched or failed, or it is gone (its demo school was purged).
 */
export async function loadDispatchableEvent(db: DatabaseExecutor, eventId: string): Promise<DispatchableEvent | null> {
  const [event] = await db
    .select({
      id: notificationEventTable.id,
      schoolId: notificationEventTable.schoolId,
      type: notificationEventTable.type,
      data: notificationEventTable.data,
      recipients: notificationEventTable.recipients,
      status: notificationEventTable.status,
      isDemoSchool: schoolTable.isDemo,
      redeliveryOfDeliveryId: notificationEventTable.redeliveryOfDeliveryId,
      sendPriority: notificationEventTable.sendPriority,
    })
    .from(notificationEventTable)
    .innerJoin(schoolTable, eq(schoolTable.id, notificationEventTable.schoolId))
    .where(eq(notificationEventTable.id, eventId))
    .limit(1);
  if (!event || event.status !== 'pending') return null;
  if (!isNotificationType(event.type)) {
    throw new NotificationDispatchError('The notification type is no longer known to this release.');
  }
  const recipients = notificationRecipientSpecSchema.safeParse(event.recipients);
  if (!recipients.success || recipients.data.kind !== RECIPIENT_SPEC_KIND_BY_AUDIENCE[notificationCatalogue[event.type].audience]) {
    throw new NotificationDispatchError('The notification recipients do not match its audience.');
  }
  let redeliveryOf: DispatchableEvent['redeliveryOf'] = null;
  if (event.redeliveryOfDeliveryId) {
    const [original] = await db
      .select({
        id: notificationDeliveryTable.id,
        notificationId: notificationDeliveryTable.notificationId,
        channel: notificationDeliveryTable.channel,
        destination: notificationDeliveryTable.destination,
      })
      .from(notificationDeliveryTable)
      .where(and(eq(notificationDeliveryTable.id, event.redeliveryOfDeliveryId), eq(notificationDeliveryTable.schoolId, event.schoolId)))
      .limit(1);
    if (!original) throw new NotificationDispatchError('The delivery to resend no longer exists.');
    redeliveryOf = { deliveryId: original.id, notificationId: original.notificationId, channel: original.channel, destination: original.destination };
  }
  return {
    id: event.id,
    schoolId: event.schoolId,
    isDemoSchool: event.isDemoSchool,
    type: event.type,
    data: event.data,
    recipients: recipients.data,
    sendPriority: event.sendPriority,
    redeliveryOf,
  };
}

/**
 * Resolves the emitter's recipient spec to recipients of the event's school,
 * in the order stated, dropping anyone who does not qualify:
 * - staff users must currently be members of the school (a notification is
 *   itself a disclosure; a removed member gets nothing new);
 * - admissions must belong to the school. Registration is not checked: the
 *   emitter decides whether an unregistered student is concerned (Cadet
 *   access survives unregistering, see docs/cadet-portal.md). An admission
 *   without a Cadet login still gets its row; it appears once a login exists.
 */
export async function resolveNotificationRecipients(db: DatabaseExecutor, event: DispatchableEvent): Promise<ResolvedRecipient[]> {
  const spec = event.recipients;
  if (spec.kind === 'staff_users') {
    const members = await db
      .select({ userId: schoolMemberTable.userId })
      .from(schoolMemberTable)
      .where(and(eq(schoolMemberTable.schoolId, event.schoolId), inArray(schoolMemberTable.userId, spec.userIds)));
    const memberIds = new Set(members.map((member) => member.userId));
    return spec.userIds.filter((userId) => memberIds.has(userId)).map((userId) => ({ kind: 'staff_user', id: userId }));
  }
  return resolveAdmissionRecipients(db, event.schoolId, spec.admissionIds);
}

/**
 * Admissions of a school as recipients with their channel facts (WhatsApp
 * number, verification, consent, active push subscriptions), in the order
 * given; IDs outside the school are dropped. Shared by the fan-out and by
 * button sends that forecast deliveries before emitting (D-26).
 */
export async function resolveAdmissionRecipients(
  db: DatabaseExecutor,
  schoolId: string,
  admissionIds: readonly string[],
): Promise<Extract<ResolvedRecipient, { kind: 'admission' }>[]> {
  if (admissionIds.length === 0) return [];
  const admissions = await db
    .select({
      id: admissionTable.id,
      whatsappNo: admissionTable.whatsappNo,
      whatsappVerified: admissionTable.whatsappVerified,
      whatsappConsent: admissionTable.whatsappConsent,
    })
    .from(admissionTable)
    .where(and(eq(admissionTable.schoolId, schoolId), inArray(admissionTable.id, [...admissionIds])));
  const byId = new Map(admissions.map((admission) => [admission.id, admission]));
  const subscriptions = await activePushSubscriptionIdsByAdmission(db, admissions.map((admission) => admission.id));
  return admissionIds.flatMap((admissionId) => {
    const admission = byId.get(admissionId);
    return admission ? [{ kind: 'admission' as const, ...admission, pushSubscriptionIds: subscriptions.get(admissionId) ?? [] }] : [];
  });
}

/** Per remote channel: copies that would be owed, and skips by reason. */
export type DeliveryForecast = {
  recipientCount: number;
  channels: Record<RemoteNotificationChannel, { owed: number; skipped: Partial<Record<NotificationSkipReason, number>> }>;
};

/**
 * What a fan-out of `type` to these recipients would decide right now, by
 * the same rules ({@link planNotificationRows}): copies owed per channel and
 * skips per reason. Shown to staff before a button send and stored with it
 * (D-26). The fan-out decides again when it runs, so a number or consent
 * changed in between is honoured; the recipients are what is snapshotted.
 * Web push counts copies (one per subscription), WhatsApp one per student.
 */
export function forecastDeliveries(
  type: NotificationType,
  isDemoSchool: boolean,
  recipients: readonly ResolvedRecipient[],
  adapters: Record<RemoteNotificationChannel, NotificationChannelAdapter> = notificationChannelAdapters,
): DeliveryForecast {
  const channels = Object.fromEntries(
    REMOTE_NOTIFICATION_CHANNELS.map((channel) => [channel, { owed: 0, skipped: {} }]),
  ) as DeliveryForecast['channels'];
  const planned = planNotificationRows({ id: 'forecast', type, isDemoSchool }, recipients, adapters);
  for (const notification of planned) {
    for (const delivery of notification.deliveries) {
      const bucket = channels[delivery.channel];
      if (delivery.status === 'owed') bucket.owed += 1;
      else if (delivery.skipReason) bucket.skipped[delivery.skipReason] = (bucket.skipped[delivery.skipReason] ?? 0) + 1;
    }
  }
  return { recipientCount: recipients.length, channels };
}

/** One planned delivery row. */
export type PlannedDelivery = {
  id: string;
  channel: RemoteNotificationChannel;
  destination: string | null;
  status: 'owed' | 'skipped';
  skipReason: NotificationSkipReason | null;
  /** The failed delivery a staff resend replaces; null for a first delivery. */
  resendOfDeliveryId?: string | null;
};

/** One planned inbox row with its delivery rows. */
export type PlannedNotification = {
  id: string;
  recipientKind: ResolvedRecipient['kind'];
  recipientId: string;
  deliveries: PlannedDelivery[];
};

function toPlannedDelivery(notificationId: string, channel: RemoteNotificationChannel, decision: DeliveryDecision): PlannedDelivery {
  return {
    id: notificationDeliveryId(notificationId, channel, decision.destination),
    channel,
    destination: decision.destination,
    status: decision.status,
    skipReason: decision.status === 'skipped' ? decision.reason : null,
  };
}

/**
 * The rows an event owes. One inbox row per recipient; one delivery row per
 * remote channel the type allows and per destination the channel decided.
 * The result depends on the adapters (each channel's kill switch, read from
 * the environment when the worker starts), not only on journaled inputs, so
 * the dispatch workflow runs it inside a journaled step: a replay on a
 * worker whose switches changed reuses the recorded plan instead of planning
 * different rows. Send targets are taken from that plan, never from an
 * insert's `RETURNING` (a replay inserts nothing and would send nothing).
 */
export function planNotificationRows(
  event: Pick<DispatchableEvent, 'id' | 'type' | 'isDemoSchool'>,
  recipients: readonly ResolvedRecipient[],
  adapters: Record<RemoteNotificationChannel, NotificationChannelAdapter> = notificationChannelAdapters,
): PlannedNotification[] {
  const allowed = notificationCatalogue[event.type].channels;
  const channels = REMOTE_NOTIFICATION_CHANNELS.filter((channel) => (allowed as readonly string[]).includes(channel));
  return recipients.map((recipient) => {
    const id = notificationRowId(event.id, { kind: recipient.kind, id: recipient.id });
    const deliveries = channels.flatMap((channel) =>
      decideDeliveries(adapters[channel], { isDemoSchool: event.isDemoSchool, recipient }).map((decision) =>
        toPlannedDelivery(id, channel, decision),
      ),
    );
    return { id, recipientKind: recipient.kind, recipientId: recipient.id, deliveries };
  });
}

/**
 * The queue columns of a planned delivery row (D-39): an owed copy is due
 * now, in the event's priority, on its school's sender lane.
 */
function queueColumns(event: Pick<DispatchableEvent, 'schoolId' | 'sendPriority'>, delivery: PlannedDelivery, now: Date) {
  return {
    sendPriority: event.sendPriority,
    sendLane: senderLaneFor(delivery.channel, event.schoolId),
    nextAttemptAt: delivery.status === 'owed' ? now : null,
  };
}

/** The senders a set of planned deliveries owes a poke (lanes with owed rows). */
export function senderTargetsOf(event: Pick<DispatchableEvent, 'schoolId'>, deliveries: readonly PlannedDelivery[]): SenderTarget[] {
  return uniqueSenderTargets(
    deliveries.filter((delivery) => delivery.status === 'owed').map((delivery) => ({ channel: delivery.channel, lane: senderLaneFor(delivery.channel, event.schoolId) })),
  );
}

/**
 * Inserts one chunk of planned rows in one transaction, `ON CONFLICT DO
 * NOTHING`, so a replayed chunk changes nothing. The event row is locked
 * `FOR SHARE` first: a concurrent demo purge (which deletes the event) waits,
 * and a purged event inserts nothing (`'event_gone'`).
 */
export async function insertNotificationChunk(
  event: Pick<DispatchableEvent, 'id' | 'schoolId' | 'type' | 'data' | 'sendPriority'>,
  chunk: readonly PlannedNotification[],
  db: typeof defaultDb = defaultDb,
): Promise<'inserted' | 'event_gone'> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: notificationEventTable.id })
      .from(notificationEventTable)
      .where(eq(notificationEventTable.id, event.id))
      .for('share');
    if (!locked) return 'event_gone';
    if (chunk.length === 0) return 'inserted';
    await tx
      .insert(notificationTable)
      .values(
        chunk.map((planned) => ({
          id: planned.id,
          eventId: event.id,
          schoolId: event.schoolId,
          recipientKind: planned.recipientKind,
          userId: planned.recipientKind === 'staff_user' ? planned.recipientId : null,
          admissionId: planned.recipientKind === 'admission' ? planned.recipientId : null,
          type: event.type,
          data: event.data,
        })),
      )
      .onConflictDoNothing({ target: notificationTable.id });
    const now = new Date();
    const deliveries = chunk.flatMap((planned) =>
      planned.deliveries.map((delivery) => ({
        id: delivery.id,
        notificationId: planned.id,
        schoolId: event.schoolId,
        channel: delivery.channel,
        destination: delivery.destination,
        status: delivery.status,
        skipReason: delivery.skipReason,
        resendOfDeliveryId: delivery.resendOfDeliveryId ?? null,
        ...queueColumns(event, delivery, now),
      })),
    );
    if (deliveries.length > 0) {
      await tx.insert(notificationDeliveryTable).values(deliveries).onConflictDoNothing({ target: notificationDeliveryTable.id });
    }
    return 'inserted';
  });
}

/**
 * The delivery rows a staff resend owes: the channel decides again for the
 * recipient's current facts (number, consent, subscriptions, demo school),
 * so a corrected number is used and a withdrawn consent is honoured. IDs are
 * derived from the redelivery event, never colliding with the original.
 */
export function planRedeliveryRows(
  event: Pick<DispatchableEvent, 'id' | 'isDemoSchool'> & { redeliveryOf: NonNullable<DispatchableEvent['redeliveryOf']> },
  recipients: readonly ResolvedRecipient[],
  adapters: Record<RemoteNotificationChannel, NotificationChannelAdapter> = notificationChannelAdapters,
): PlannedDelivery[] {
  const recipient = recipients[0];
  if (!recipient) return [];
  const { notificationId, channel, deliveryId } = event.redeliveryOf;
  let decisions = decideDeliveries(adapters[channel], { isDemoSchool: event.isDemoSchool, recipient });
  if (channel === 'web_push') {
    // D-40: a push resend goes to the device that missed it, never to every
    // device the student has now. Gone since the resend was asked for: skipped.
    // A channel-level skip (switched off, demo school) keeps its own reason.
    const original = event.redeliveryOf.destination;
    const same = decisions.find((decision) => decision.status === 'owed' && decision.destination === original);
    const channelSkip = decisions.find((decision) => decision.status === 'skipped' && decision.reason !== 'no_subscription');
    decisions = same ? [same] : channelSkip ? [channelSkip] : [{ status: 'skipped', reason: 'no_subscription', destination: original }];
  }
  return decisions.map((decision) => ({
    id: notificationRedeliveryId(notificationId, channel, decision.destination, event.id),
    channel,
    destination: decision.destination,
    status: decision.status,
    skipReason: decision.status === 'skipped' ? decision.reason : null,
    resendOfDeliveryId: deliveryId,
  }));
}

/**
 * Inserts a resend's delivery rows under the event's `FOR SHARE` lock (as
 * {@link insertNotificationChunk}), `ON CONFLICT DO NOTHING`.
 */
export async function insertRedeliveryRows(
  event: Pick<DispatchableEvent, 'id' | 'schoolId' | 'sendPriority'> & { redeliveryOf: NonNullable<DispatchableEvent['redeliveryOf']> },
  rows: readonly PlannedDelivery[],
  db: typeof defaultDb = defaultDb,
): Promise<'inserted' | 'event_gone'> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: notificationEventTable.id })
      .from(notificationEventTable)
      .where(eq(notificationEventTable.id, event.id))
      .for('share');
    if (!locked) return 'event_gone';
    if (rows.length === 0) return 'inserted';
    const now = new Date();
    await tx
      .insert(notificationDeliveryTable)
      .values(
        rows.map((row) => ({
          ...queueColumns(event, row, now),
          id: row.id,
          notificationId: event.redeliveryOf.notificationId,
          schoolId: event.schoolId,
          channel: row.channel,
          destination: row.destination,
          status: row.status,
          skipReason: row.skipReason,
          resendOfDeliveryId: row.resendOfDeliveryId ?? null,
        })),
      )
      .onConflictDoNothing({ target: notificationDeliveryTable.id });
    return 'inserted';
  });
}

/** Marks a pending event dispatched; a no-op for any other status. */
export async function markNotificationEventDispatched(db: DatabaseExecutor, eventId: string, notificationCount: number) {
  await db
    .update(notificationEventTable)
    .set({ status: 'dispatched', notificationCount, dispatchedAt: new Date(), error: null, updatedAt: new Date() })
    .where(and(eq(notificationEventTable.id, eventId), eq(notificationEventTable.status, 'pending')));
}

/**
 * Marks a pending event failed with a safe message, recording whether the
 * failure may be retried automatically. Fenced on the attempt, so a late
 * failure of an older attempt never fails a newer one.
 */
export async function failNotificationEvent(
  db: DatabaseExecutor,
  eventId: string,
  message: string,
  options: { retryable: boolean; attempt: number },
) {
  await db
    .update(notificationEventTable)
    .set({ status: 'failed', error: message, failureRetryable: options.retryable, updatedAt: new Date() })
    .where(
      and(
        eq(notificationEventTable.id, eventId),
        eq(notificationEventTable.status, 'pending'),
        eq(notificationEventTable.dispatchAttempt, options.attempt),
      ),
    );
}

/**
 * Records a dispatch attempt that ended with a terminal error: the event is
 * failed if it is still pending ({@link failNotificationEvent}; a retryable
 * failure is fanned out again by the sweep, which writes the same planned
 * rows). Once the event is dispatched there is nothing left to fail: every
 * row is written, and owed deliveries belong to the channel senders, which
 * the API sweep pokes while any are due (D-39), so no delivery can be left
 * owed by a dispatch that ended early.
 */
export async function failNotificationDispatch(
  eventId: string,
  message: string,
  options: { retryable: boolean; attempt: number },
  db: DatabaseExecutor = defaultDb,
) {
  await failNotificationEvent(db, eventId, message, options);
}

/** Runs one named unit of work; Restate journals it, tests call it directly. */
export type NotificationStepRunner = <T>(name: string, action: () => Promise<T>) => Promise<T>;

/**
 * Starts the senders of these lanes (D-39); the workflow sends one-way
 * calls to the `NotificationSender` virtual objects. A lost poke only
 * delays: the API sweep pokes every lane with due rows every 30 s.
 */
export type NotificationSenderPoke = (targets: readonly SenderTarget[]) => Promise<void>;

export type NotificationDispatchResult =
  | { status: 'skipped' }
  | { status: 'event_gone' }
  | { status: 'dispatched'; notificationCount: number; owedDeliveryCount: number };

/**
 * The fan-out shared by the workflow and the tests. Steps, in order: load
 * the pending event, resolve recipients, plan the rows (journaled, so a
 * replay inserts exactly the recorded plan even if a channel was switched
 * on or off in between), insert rows chunk by chunk, mark the event
 * dispatched, then poke the senders of the lanes that got owed copies. It
 * sends nothing itself: `notification_delivery` is the queue and each
 * channel's sender drains it at the channel's rate (D-39). A redelivery
 * event (staff resend) inserts only its new delivery rows.
 */
export async function runNotificationDispatch(options: {
  eventId: string;
  step: NotificationStepRunner;
  poke: NotificationSenderPoke;
  adapters?: Record<RemoteNotificationChannel, NotificationChannelAdapter>;
}): Promise<NotificationDispatchResult> {
  const { eventId, step, poke } = options;
  const adapters = options.adapters ?? notificationChannelAdapters;
  const event = await step('load-event', () => loadDispatchableEvent(defaultDb, eventId));
  if (!event) return { status: 'skipped' };
  const recipients = await step('resolve-recipients', () => resolveNotificationRecipients(defaultDb, event));
  if (event.redeliveryOf) {
    const redelivery = { ...event, redeliveryOf: event.redeliveryOf };
    const rows = await step('plan-redelivery', async () => planRedeliveryRows(redelivery, recipients, adapters));
    const inserted = await step('insert-redelivery', () => insertRedeliveryRows(redelivery, rows));
    if (inserted === 'event_gone') return { status: 'event_gone' };
    await step('mark-dispatched', () => markNotificationEventDispatched(defaultDb, eventId, 0));
    await poke(senderTargetsOf(event, rows));
    return { status: 'dispatched', notificationCount: 0, owedDeliveryCount: rows.filter((row) => row.status === 'owed').length };
  }
  const planned = await step('plan', async () => planNotificationRows(event, recipients, adapters));
  for (let start = 0; start < planned.length || start === 0; start += NOTIFICATION_INSERT_CHUNK) {
    const chunk = planned.slice(start, start + NOTIFICATION_INSERT_CHUNK);
    const inserted = await step(`insert:${start / NOTIFICATION_INSERT_CHUNK}`, () => insertNotificationChunk(event, chunk));
    if (inserted === 'event_gone') return { status: 'event_gone' };
  }
  await step('mark-dispatched', () => markNotificationEventDispatched(defaultDb, eventId, planned.length));
  const deliveries = planned.flatMap((notification) => notification.deliveries);
  await poke(senderTargetsOf(event, deliveries));
  return { status: 'dispatched', notificationCount: planned.length, owedDeliveryCount: deliveries.filter((delivery) => delivery.status === 'owed').length };
}
