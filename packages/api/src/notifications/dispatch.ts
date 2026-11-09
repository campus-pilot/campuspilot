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
import { claimDelivery, recordDeliveryOutcome } from './deliveries';
import { notificationDeliveryId, notificationRowId } from './ids';

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
  return {
    id: event.id,
    schoolId: event.schoolId,
    isDemoSchool: event.isDemoSchool,
    type: event.type,
    data: event.data,
    recipients: recipients.data,
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
  const admissions = await db
    .select({
      id: admissionTable.id,
      whatsappNo: admissionTable.whatsappNo,
      whatsappVerified: admissionTable.whatsappVerified,
      whatsappConsent: admissionTable.whatsappConsent,
    })
    .from(admissionTable)
    .where(and(eq(admissionTable.schoolId, event.schoolId), inArray(admissionTable.id, spec.admissionIds)));
  const byId = new Map(admissions.map((admission) => [admission.id, admission]));
  return spec.admissionIds.flatMap((admissionId) => {
    const admission = byId.get(admissionId);
    return admission ? [{ kind: 'admission' as const, ...admission }] : [];
  });
}

/** One planned delivery row. */
export type PlannedDelivery = {
  id: string;
  channel: RemoteNotificationChannel;
  destination: string | null;
  status: 'owed' | 'skipped';
  skipReason: NotificationSkipReason | null;
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
 * The rows an event owes, computed purely from journaled inputs so every
 * replay proposes identical IDs. One inbox row per recipient; one delivery
 * row per remote channel the type allows and per destination the channel
 * decided. Send targets are taken from these proposed rows, never from an
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
 * Inserts one chunk of planned rows in one transaction, `ON CONFLICT DO
 * NOTHING`, so a replayed chunk changes nothing. The event row is locked
 * `FOR SHARE` first: a concurrent demo purge (which deletes the event) waits,
 * and a purged event inserts nothing (`'event_gone'`).
 */
export async function insertNotificationChunk(
  event: Pick<DispatchableEvent, 'id' | 'schoolId' | 'type' | 'data'>,
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
    const deliveries = chunk.flatMap((planned) =>
      planned.deliveries.map((delivery) => ({
        id: delivery.id,
        notificationId: planned.id,
        schoolId: event.schoolId,
        channel: delivery.channel,
        destination: delivery.destination,
        status: delivery.status,
        skipReason: delivery.skipReason,
      })),
    );
    if (deliveries.length > 0) {
      await tx.insert(notificationDeliveryTable).values(deliveries).onConflictDoNothing({ target: notificationDeliveryTable.id });
    }
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

/** Marks a pending event failed with a safe message. */
export async function failNotificationEvent(db: DatabaseExecutor, eventId: string, message: string) {
  await db
    .update(notificationEventTable)
    .set({ status: 'failed', error: message, updatedAt: new Date() })
    .where(and(eq(notificationEventTable.id, eventId), eq(notificationEventTable.status, 'pending')));
}

/**
 * Claims and sends one owed delivery on its channel and records the outcome
 * (see `./deliveries.ts`). A delivery that is no longer owed (already sent,
 * or stuck in `sending` after a crash) is left alone.
 */
export async function sendOwedDelivery(
  deliveryId: string,
  channel: RemoteNotificationChannel,
  adapters: Record<RemoteNotificationChannel, NotificationChannelAdapter> = notificationChannelAdapters,
  db: DatabaseExecutor = defaultDb,
): Promise<'sent' | 'retry' | 'failed' | 'not_owed'> {
  const adapter = adapters[channel];
  if (!adapter.available) return 'not_owed';
  const claimed = await claimDelivery(db, deliveryId);
  if (!claimed) return 'not_owed';
  const outcome = await adapter.send(claimed);
  await recordDeliveryOutcome(db, deliveryId, outcome);
  return outcome.kind;
}

/** Runs one named unit of work; Restate journals it, tests call it directly. */
export type NotificationStepRunner = <T>(name: string, action: () => Promise<T>) => Promise<T>;

export type NotificationDispatchResult =
  | { status: 'skipped' }
  | { status: 'event_gone' }
  | { status: 'dispatched'; notificationCount: number; owedDeliveryCount: number };

/**
 * The dispatch loop shared by the workflow and the tests. Steps, in order:
 * load the pending event, resolve recipients (journaled, so replays plan the
 * same rows), insert rows chunk by chunk, mark the event dispatched, then
 * claim and send each owed delivery.
 *
 * In this release no remote channel is available, so nothing is owed and the
 * send phase does nothing. Retry scheduling for `retry` outcomes (durable
 * backoff, bounded attempts, then `failed`) is added with the first real
 * channel; until then a `retry` leaves the delivery `owed`.
 */
export async function runNotificationDispatch(options: {
  eventId: string;
  step: NotificationStepRunner;
  adapters?: Record<RemoteNotificationChannel, NotificationChannelAdapter>;
}): Promise<NotificationDispatchResult> {
  const { eventId, step } = options;
  const adapters = options.adapters ?? notificationChannelAdapters;
  const event = await step('load-event', () => loadDispatchableEvent(defaultDb, eventId));
  if (!event) return { status: 'skipped' };
  const recipients = await step('resolve-recipients', () => resolveNotificationRecipients(defaultDb, event));
  const planned = planNotificationRows(event, recipients, adapters);
  for (let start = 0; start < planned.length || start === 0; start += NOTIFICATION_INSERT_CHUNK) {
    const chunk = planned.slice(start, start + NOTIFICATION_INSERT_CHUNK);
    const inserted = await step(`insert:${start / NOTIFICATION_INSERT_CHUNK}`, () => insertNotificationChunk(event, chunk));
    if (inserted === 'event_gone') return { status: 'event_gone' };
  }
  await step('mark-dispatched', () => markNotificationEventDispatched(defaultDb, eventId, planned.length));
  const owed = planned.flatMap((notification) =>
    notification.deliveries.filter((delivery) => delivery.status === 'owed'),
  );
  for (const delivery of owed) {
    await step(`send:${delivery.id}`, () => sendOwedDelivery(delivery.id, delivery.channel, adapters));
  }
  return { status: 'dispatched', notificationCount: planned.length, owedDeliveryCount: owed.length };
}
