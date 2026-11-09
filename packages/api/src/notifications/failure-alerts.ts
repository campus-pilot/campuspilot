import { db as defaultDb, type Database } from '@campuspilot/db';
import { isNotificationType } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { schoolMembersWithPermission } from '../permissions/authorization';
import { log } from '../workflows/notification/log';
import { handOffNotificationEvents } from './notification.outbox';
import { notify } from './notify';

/** Failed deliveries reported per sweep; the next sweep continues. */
const ALERT_SWEEP_LIMIT = 50;

/**
 * Tells staff about failed WhatsApp deliveries (D-30) on the API's 30 s
 * loop: each failed WhatsApp delivery, however it failed (send error,
 * retries exhausted, failure receipt from the webhook), yields one
 * `notification.whatsapp_failed` (key `whatsapp-failed:<deliveryId>`) to
 * the school's members granted `school.notification.failure.receive`
 * (accountants today; the grant is the role list). Marking the delivery
 * `failure_alerted_at` and emitting happen in one transaction, conditional
 * on it being unmarked, so each failure is reported once across replicas.
 * Recipients are resolved through OPA outside that transaction; a school
 * with nobody holding the grant marks the failure reported without an
 * event. A sweep that cannot reach OPA leaves the failures for the next.
 */
export async function sweepWhatsAppFailureAlerts(db: Database = defaultDb) {
  const failed = await db
    .select({
      id: notificationDeliveryTable.id,
      schoolId: notificationDeliveryTable.schoolId,
      errorCode: notificationDeliveryTable.errorCode,
      type: notificationTable.type,
      data: notificationTable.data,
      admissionId: notificationTable.admissionId,
    })
    .from(notificationDeliveryTable)
    .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
    .where(
      and(
        eq(notificationDeliveryTable.channel, 'whatsapp'),
        eq(notificationDeliveryTable.status, 'failed'),
        isNull(notificationDeliveryTable.failureAlertedAt),
      ),
    )
    .orderBy(asc(notificationDeliveryTable.failedAt))
    .limit(ALERT_SWEEP_LIMIT);
  const recipientsBySchool = new Map<string, string[]>();
  const eventIds: string[] = [];
  let reported = 0;
  for (const delivery of failed) {
    let recipients = recipientsBySchool.get(delivery.schoolId);
    if (!recipients) {
      recipients = await schoolMembersWithPermission(db, delivery.schoolId, SCHOOL_ACTIONS.RECEIVE_NOTIFICATION_FAILURES);
      recipientsBySchool.set(delivery.schoolId, recipients);
    }
    const studentName = typeof delivery.data.studentName === 'string' && delivery.data.studentName ? delivery.data.studentName : null;
    const eventId = await db.transaction(async (tx) => {
      const [marked] = await tx
        .update(notificationDeliveryTable)
        .set({ failureAlertedAt: new Date() })
        .where(and(eq(notificationDeliveryTable.id, delivery.id), isNull(notificationDeliveryTable.failureAlertedAt)))
        .returning({ id: notificationDeliveryTable.id });
      if (!marked) return null;
      reported += 1;
      if (recipients.length === 0 || !delivery.admissionId || !studentName || !isNotificationType(delivery.type)) return null;
      const result = await notify(tx, {
        type: 'notification.whatsapp_failed',
        schoolId: delivery.schoolId,
        key: `whatsapp-failed:${delivery.id}`,
        recipients: { kind: 'staff_users', userIds: recipients },
        data: {
          admissionId: delivery.admissionId,
          studentName,
          failedType: delivery.type,
          ...(delivery.errorCode ? { errorCode: delivery.errorCode.slice(0, 100) } : {}),
        },
      });
      return result.eventId;
    });
    if (eventId) eventIds.push(eventId);
  }
  handOffNotificationEvents(eventIds);
  if (reported > 0) log.info({ reported, alerted: eventIds.length }, 'notification.whatsapp_failures.reported');
  return { reported, alerted: eventIds.length };
}
