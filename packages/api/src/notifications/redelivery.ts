import { db as defaultDb, type Database } from '@campuspilot/db';
import { isNotificationType, notificationCatalogue, type NotificationType } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, eq } from 'drizzle-orm';

import { rpcError } from '../errors';
import { handOffNotificationEvents } from './notification.outbox';
import { notify, type AnyNotifyInput } from './notify';

/**
 * Staff "Resend" of one failed delivery (Phase 7). Writes one redelivery
 * event (key `resend:<deliveryId>`) that the ordinary durable fan-out turns
 * into a new delivery of the same notification on the same channel, with
 * the recipient's current facts (a corrected WhatsApp number, withdrawn
 * consent, demo school) and the same bounded retries. Idempotent: a failed
 * delivery is resent at most once; if the resend fails too, its own new
 * delivery can be resent. Only `failed` deliveries of the school's student
 * notifications qualify; the inbox row is not duplicated.
 */
export async function resendFailedDelivery(
  input: { schoolId: string; deliveryId: string; requestedBy: string },
  db: Database = defaultDb,
): Promise<{ eventId: string; created: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: notificationDeliveryTable.status,
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
