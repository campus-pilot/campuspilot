import { db as defaultDb, type Database } from '@campuspilot/db';
import { isNotificationType, type AdmissionNotificationType } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, asc, eq, exists, gt, isNotNull, isNull, min, or, sql } from 'drizzle-orm';

import { schoolMembersWithPermission } from '../permissions/authorization';
import { log } from '../workflows/notification/log';
import { handOffNotificationEvents } from './notification.outbox';
import { notify, type NotificationBatchKind } from './notify';

/**
 * Failure alerts for WhatsApp (D-38), on the API's 30 s loop. Every failed
 * WhatsApp delivery (send error, retries exhausted, failure receipt from
 * the webhook, unknown outcome) is reported to staff once:
 * - **who**: the school's members granted the failure topic of the
 *   notification type ({@link FAILURE_TOPIC}): finance failures to
 *   `school.notification.failure.finance.receive` (principal, manager,
 *   accountant), result failures to
 *   `school.notification.failure.results.receive` (principal, manager;
 *   never accountants). The grants are the only role lists. A send staff
 *   asked for themselves (a single result send, a resend: the event's
 *   `alert_creator_on_failure`) also alerts that staff member.
 * - **how**: one `notification.whatsapp_failed` per failed delivery of a
 *   one-off event (a payment, a manual bill, a single send) and per failed
 *   resend; one `notification.whatsapp_batch_failed` per bulk batch
 *   (billing run, results publication) once the batch's WhatsApp copies
 *   settled (no event still pending, nothing owed or freshly claimed),
 *   counting the failures not reported before, so a run of 5,000 bills
 *   yields one alert, not hundreds. A failure receipt arriving later yields
 *   a follow-up alert for that batch.
 * Web push failures are never alerted (a gone subscription is the device's
 * own state, and the inbox holds the notification anyway).
 *
 * Marking deliveries `failure_alerted_at` and emitting happen in one
 * transaction, conditional on them being unmarked, so replicas report each
 * failure once. Recipients are resolved through OPA outside that
 * transaction; a failure nobody may be told about is marked reported
 * without an event. A sweep that cannot reach OPA leaves the rest for the
 * next.
 */

/** Which failure-alert grant a student notification type's failures go to (D-38). */
export const FAILURE_TOPIC: Record<AdmissionNotificationType, 'finance' | 'results'> = {
  'bill.issued': 'finance',
  'payment.received': 'finance',
  'exam.results_published': 'results',
};

const TOPIC_ACTION = {
  finance: SCHOOL_ACTIONS.RECEIVE_FINANCE_NOTIFICATION_FAILURES,
  results: SCHOOL_ACTIONS.RECEIVE_RESULT_NOTIFICATION_FAILURES,
} as const;

/** One-off failures and batches handled per sweep; the next sweep continues. */
const ALERT_SWEEP_LIMIT = 50;
/** A WhatsApp copy claimed longer ago than this without an outcome no longer keeps its batch open (the worker died mid-send). */
const STUCK_SENDING_MS = 60 * 60 * 1000;

const unalertedWhatsAppFailure = and(
  eq(notificationDeliveryTable.channel, 'whatsapp'),
  eq(notificationDeliveryTable.status, 'failed'),
  isNull(notificationDeliveryTable.failureAlertedAt),
);

function topicOf(type: string) {
  return isNotificationType(type) && Object.hasOwn(FAILURE_TOPIC, type) ? FAILURE_TOPIC[type as AdmissionNotificationType] : null;
}

/** Granted recipients per school and topic, cached for one sweep. */
function recipientResolver(db: Database) {
  const cache = new Map<string, Promise<string[]>>();
  return (schoolId: string, topic: 'finance' | 'results') => {
    const key = `${schoolId}:${topic}`;
    let found = cache.get(key);
    if (!found) {
      found = schoolMembersWithPermission(db, schoolId, TOPIC_ACTION[topic]);
      cache.set(key, found);
    }
    return found;
  };
}
type GrantedRecipients = ReturnType<typeof recipientResolver>;

/**
 * The staff member who asked for this send and to hear about its failure:
 * the event's creator for a first copy, the redelivery event's creator for
 * a resend (a resend's row hangs off the original notification and event).
 */
async function requesterOf(
  db: Database,
  delivery: { resendOfDeliveryId: string | null; createdBy: string | null; alertCreator: boolean },
) {
  if (!delivery.resendOfDeliveryId) return delivery.alertCreator ? delivery.createdBy : null;
  const [event] = await db
    .select({ createdBy: notificationEventTable.createdBy, alertCreator: notificationEventTable.alertCreatorOnFailure })
    .from(notificationEventTable)
    .where(eq(notificationEventTable.redeliveryOfDeliveryId, delivery.resendOfDeliveryId))
    .limit(1);
  return event?.alertCreator ? event.createdBy : null;
}

/** One alert per failed delivery of a one-off event, and per failed resend. */
async function alertOneOffFailures(db: Database, granted: GrantedRecipients) {
  const failed = await db
    .select({
      id: notificationDeliveryTable.id,
      schoolId: notificationDeliveryTable.schoolId,
      errorCode: notificationDeliveryTable.errorCode,
      resendOfDeliveryId: notificationDeliveryTable.resendOfDeliveryId,
      type: notificationTable.type,
      data: notificationTable.data,
      admissionId: notificationTable.admissionId,
      createdBy: notificationEventTable.createdBy,
      alertCreator: notificationEventTable.alertCreatorOnFailure,
    })
    .from(notificationDeliveryTable)
    .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
    .innerJoin(notificationEventTable, eq(notificationEventTable.id, notificationTable.eventId))
    .where(and(unalertedWhatsAppFailure, or(isNull(notificationEventTable.batchKind), isNotNull(notificationDeliveryTable.resendOfDeliveryId))))
    .orderBy(asc(notificationDeliveryTable.failedAt))
    .limit(ALERT_SWEEP_LIMIT);
  const eventIds: string[] = [];
  let reported = 0;
  for (const delivery of failed) {
    const topic = topicOf(delivery.type);
    const recipients = new Set(topic ? await granted(delivery.schoolId, topic) : []);
    const requester = await requesterOf(db, delivery);
    if (requester) recipients.add(requester);
    const studentName = typeof delivery.data.studentName === 'string' && delivery.data.studentName ? delivery.data.studentName : null;
    const eventId = await db.transaction(async (tx) => {
      const [marked] = await tx
        .update(notificationDeliveryTable)
        .set({ failureAlertedAt: new Date() })
        .where(and(eq(notificationDeliveryTable.id, delivery.id), isNull(notificationDeliveryTable.failureAlertedAt)))
        .returning({ id: notificationDeliveryTable.id });
      if (!marked) return null;
      reported += 1;
      if (recipients.size === 0 || !delivery.admissionId || !studentName || !isNotificationType(delivery.type)) return null;
      const result = await notify(tx, {
        type: 'notification.whatsapp_failed',
        schoolId: delivery.schoolId,
        key: `whatsapp-failed:${delivery.id}`,
        sendPriority: 'immediate',
        recipients: { kind: 'staff_users', userIds: [...recipients] },
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
  return { reported, eventIds };
}

/** First copies (not resends) of one batch's notifications. */
function batchDeliveries(schoolId: string, kind: NotificationBatchKind, batchId: string) {
  return and(
    eq(notificationDeliveryTable.schoolId, schoolId),
    isNull(notificationDeliveryTable.resendOfDeliveryId),
    exists(
      sql`(select 1 from ${notificationTable} join ${notificationEventTable} on ${notificationEventTable.id} = ${notificationTable.eventId}
        where ${notificationTable.id} = ${notificationDeliveryTable.notificationId}
          and ${notificationEventTable.schoolId} = ${schoolId}
          and ${notificationEventTable.batchKind} = ${kind}
          and ${notificationEventTable.batchId} = ${batchId})`,
    ),
  );
}

/**
 * Whether a batch may still produce WhatsApp outcomes: an event not yet
 * fanned out, or a WhatsApp copy owed or claimed recently.
 */
async function batchOpen(db: Database, batch: { schoolId: string; kind: NotificationBatchKind; batchId: string }, now: Date) {
  const [pendingEvent] = await db
    .select({ id: notificationEventTable.id })
    .from(notificationEventTable)
    .where(
      and(
        eq(notificationEventTable.schoolId, batch.schoolId),
        eq(notificationEventTable.batchKind, batch.kind),
        eq(notificationEventTable.batchId, batch.batchId),
        eq(notificationEventTable.status, 'pending'),
      ),
    )
    .limit(1);
  if (pendingEvent) return true;
  const [open] = await db
    .select({ id: notificationDeliveryTable.id })
    .from(notificationDeliveryTable)
    .where(
      and(
        batchDeliveries(batch.schoolId, batch.kind, batch.batchId),
        eq(notificationDeliveryTable.channel, 'whatsapp'),
        or(
          eq(notificationDeliveryTable.status, 'owed'),
          and(eq(notificationDeliveryTable.status, 'sending'), gt(notificationDeliveryTable.claimedAt, new Date(now.getTime() - STUCK_SENDING_MS))),
        ),
      ),
    )
    .limit(1);
  return Boolean(open);
}

/** One grouped alert per settled batch with unreported failures. */
async function alertBatchFailures(db: Database, granted: GrantedRecipients, now: Date) {
  const batches = await db
    .select({
      schoolId: notificationEventTable.schoolId,
      kind: notificationEventTable.batchKind,
      batchId: notificationEventTable.batchId,
    })
    .from(notificationDeliveryTable)
    .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
    .innerJoin(notificationEventTable, eq(notificationEventTable.id, notificationTable.eventId))
    .where(and(unalertedWhatsAppFailure, isNotNull(notificationEventTable.batchKind), isNull(notificationDeliveryTable.resendOfDeliveryId)))
    .groupBy(notificationEventTable.schoolId, notificationEventTable.batchKind, notificationEventTable.batchId)
    .orderBy(asc(min(notificationDeliveryTable.failedAt)))
    .limit(ALERT_SWEEP_LIMIT);
  const eventIds: string[] = [];
  let reported = 0;
  for (const row of batches) {
    if (!row.kind || !row.batchId) continue;
    const batch = { schoolId: row.schoolId, kind: row.kind, batchId: row.batchId };
    if (await batchOpen(db, batch, now)) continue;
    const ofBatch = and(batchDeliveries(batch.schoolId, batch.kind, batch.batchId), unalertedWhatsAppFailure);
    const [sample] = await db
      .select({ type: notificationTable.type, data: notificationTable.data })
      .from(notificationDeliveryTable)
      .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
      .where(ofBatch)
      .limit(1);
    if (!sample) continue;
    const topic = topicOf(sample.type);
    const recipients = topic ? await granted(batch.schoolId, topic) : [];
    const eventId = await db.transaction(async (tx) => {
      const marked = await tx.update(notificationDeliveryTable).set({ failureAlertedAt: now }).where(ofBatch).returning({ id: notificationDeliveryTable.id });
      if (marked.length === 0) return null;
      reported += marked.length;
      const sessionId = typeof sample.data.sessionId === 'string' ? sample.data.sessionId : null;
      if (recipients.length === 0 || !sessionId) return null;
      const text = (key: string) => (typeof sample.data[key] === 'string' ? (sample.data[key] as string) : undefined);
      // Deterministic per reported set: a follow-up alert of the same batch gets its own key.
      const firstId = marked.map((delivery) => delivery.id).sort()[0]!;
      const result = await notify(tx, {
        type: 'notification.whatsapp_batch_failed',
        schoolId: batch.schoolId,
        key: `whatsapp-failed:${batch.kind}:${batch.batchId}:${firstId}`,
        sendPriority: 'immediate',
        recipients: { kind: 'staff_users', userIds: recipients },
        data: {
          batchKind: batch.kind,
          failedType: sample.type,
          failedCount: marked.length,
          sessionId,
          ...(batch.kind === 'billing_run'
            ? { billRunId: batch.batchId, periodKey: text('periodKey') }
            : { examSlug: text('examSlug'), examName: text('examName') }),
        },
      });
      return result.eventId;
    });
    if (eventId) eventIds.push(eventId);
  }
  return { reported, eventIds };
}

/** One alert sweep (see the module comment). */
export async function sweepWhatsAppFailureAlerts(db: Database = defaultDb, now: Date = new Date()) {
  const granted = recipientResolver(db);
  const oneOff = await alertOneOffFailures(db, granted);
  const batches = await alertBatchFailures(db, granted, now);
  const eventIds = [...oneOff.eventIds, ...batches.eventIds];
  handOffNotificationEvents(eventIds);
  const reported = oneOff.reported + batches.reported;
  if (reported > 0) log.info({ reported, alerted: eventIds.length }, 'notification.whatsapp_failures.reported');
  return { reported, alerted: eventIds.length };
}
