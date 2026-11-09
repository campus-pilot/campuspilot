import { db as defaultDb, type Database, type DatabaseExecutor } from '@campuspilot/db';
import { isNotificationType, notificationCatalogue, type NotificationType } from '@campuspilot/db/notifications/catalogue';
import { cadetPushSubscriptionTable, notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { rpcError } from '../errors';
import { handOffNotificationEvents } from './notification.outbox';
import { notify, type AnyNotifyInput } from './notify';

/** Web push error codes meaning the device's subscription is gone (expired, unsubscribed, revoked). */
export const PUSH_SUBSCRIPTION_GONE_ERROR_CODES: ReadonlySet<string> = new Set(['subscription_gone', 'subscription_revoked']);

/**
 * Of these web push destinations (subscription IDs), the ones still active.
 * A push resend goes to the original subscription only (D-40), so a gone
 * subscription makes a failed push not resendable.
 */
export async function activePushDestinations(db: DatabaseExecutor, destinations: readonly string[]): Promise<Set<string>> {
  if (destinations.length === 0) return new Set();
  const rows = await db
    .select({ id: cadetPushSubscriptionTable.id })
    .from(cadetPushSubscriptionTable)
    .where(and(inArray(cadetPushSubscriptionTable.id, [...destinations]), isNull(cadetPushSubscriptionTable.revokedAt)));
  return new Set(rows.map((row) => row.id));
}

/**
 * Whether a failed web push copy went to a device that no longer receives
 * notifications: the push service said so, or the subscription was revoked
 * since (turned off, signed out, access revoked).
 */
export function isPushSubscriptionGone(delivery: { channel: string; errorCode: string | null; destination: string | null }, active: ReadonlySet<string>) {
  if (delivery.channel !== 'web_push') return false;
  if (delivery.errorCode && PUSH_SUBSCRIPTION_GONE_ERROR_CODES.has(delivery.errorCode)) return true;
  return !delivery.destination || !active.has(delivery.destination);
}

/**
 * Staff "Resend" of one failed delivery (Phase 7). Writes one redelivery
 * event (key `resend:<deliveryId>`) that the ordinary durable fan-out turns
 * into a new delivery of the same notification on the same channel, with
 * the recipient's current facts (a corrected WhatsApp number, withdrawn
 * consent, demo school) and the same bounded retries. Idempotent: a failed
 * delivery is resent at most once; if the resend fails too, its own new
 * delivery can be resent. Only `failed` deliveries of the school's student
 * notifications qualify; the inbox row is not duplicated. A web push copy
 * is resent to the device that missed it only (D-40); when that device no
 * longer receives notifications the resend is refused with a clear message
 * instead of sending anything.
 */
export async function resendFailedDelivery(
  input: { schoolId: string; deliveryId: string; requestedBy: string },
  db: Database = defaultDb,
): Promise<{ eventId: string; created: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: notificationDeliveryTable.status,
        channel: notificationDeliveryTable.channel,
        errorCode: notificationDeliveryTable.errorCode,
        destination: notificationDeliveryTable.destination,
        type: notificationTable.type,
        data: notificationTable.data,
        admissionId: notificationTable.admissionId,
      })
      .from(notificationDeliveryTable)
      .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
      .where(and(eq(notificationDeliveryTable.id, input.deliveryId), eq(notificationDeliveryTable.schoolId, input.schoolId)))
      .for('update', { of: notificationDeliveryTable })
      .limit(1);
    if (!row) throw rpcError.notFound('Notification delivery');
    if (row.status !== 'failed') throw rpcError.conflict('Only a failed delivery can be resent.');
    if (row.channel === 'web_push' && isPushSubscriptionGone(row, await activePushDestinations(tx, row.destination ? [row.destination] : []))) {
      throw rpcError.conflict('This device no longer receives notifications from the Cadet Portal, so nothing was resent. The student can turn notifications on again there.');
    }
    if (!isNotificationType(row.type) || notificationCatalogue[row.type].audience !== 'admission' || !row.admissionId) {
      throw rpcError.badRequest('This notification can no longer be resent.');
    }
    const event = {
      type: row.type as NotificationType,
      data: row.data,
      schoolId: input.schoolId,
      key: `resend:${input.deliveryId}`,
      createdBy: input.requestedBy,
      // A resend is a deliberate one-off send someone is waiting for.
      sendPriority: 'immediate',
      alertCreatorOnFailure: true,
      recipients: { kind: 'admissions', admissionIds: [row.admissionId] },
      redeliveryOfDeliveryId: input.deliveryId,
    } as AnyNotifyInput;
    return notify(tx, event);
  });
  if (result.created) handOffNotificationEvents([result.eventId]);
  return result;
}
