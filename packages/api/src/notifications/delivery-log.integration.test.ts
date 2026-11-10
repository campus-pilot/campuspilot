import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createSchoolStaffSession, createTestAdmission, createTestClient, createTestSchool } from '../../test/fixtures';
import { billIssuedData, dispatchNow, drainSchool } from '../../test/notifications';
import type { DeliverySendOutcome, NotificationChannelAdapter } from './channels';
import { sweepWhatsAppFailureAlerts } from './failure-alerts';
import { notify } from './notify';
import { failStuckSendingDeliveries, INTERRUPTED_SEND_MESSAGE, STUCK_SENDING_MS } from './stuck-sending';

const pushOff: NotificationChannelAdapter = { channel: 'web_push', available: false, unavailableReason: 'test' };
function whatsapp(outcome: DeliverySendOutcome): NotificationChannelAdapter {
  return {
    channel: 'whatsapp',
    available: true,
    decide: (recipient) => (recipient.kind === 'admission' && recipient.whatsappNo ? [{ status: 'owed', destination: recipient.whatsappNo }] : [{ status: 'skipped', reason: 'no_number', destination: null }]),
    send: vi.fn(async () => outcome),
  };
}
async function dispatch(eventId: string, adapter: NotificationChannelAdapter) {
  const adapters = { web_push: pushOff, whatsapp: adapter };
  const [event] = await db.select({ schoolId: notificationEventTable.schoolId }).from(notificationEventTable).where(eq(notificationEventTable.id, eventId));
  const result = await dispatchNow(eventId, adapters);
  await drainSchool(event!.schoolId, { adapters });
  return result;
}

describe('delivery log, resend and failure alerts', () => {
  let schoolId: string, admissionId: string, accountantId: string, principalId: string, coordinatorId: string;
  let principal: ReturnType<typeof createTestClient>, accountant: ReturnType<typeof createTestClient>, teacher: ReturnType<typeof createTestClient>;
  const billRunId = 'frun_deliverylogtest00001';

  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: 'Delivery Log School' })).id;
    const admission = await createTestAdmission({ schoolId, name: 'Kavya Failed' });
    admissionId = admission.id;
    await db
      .update(admissionTable)
      .set({ phoneNo: '+919876543210', whatsappNo: '+919876543210', whatsappSameAsPhone: true, whatsappVerified: true, whatsappConsent: true })
      .where(eq(admissionTable.id, admissionId));
    // A second admission that is not ready for WhatsApp (backfilled: unverified, no consent).
    const pending = await createTestAdmission({ schoolId, name: 'Rohan Pending' });
    await db.update(admissionTable).set({ phoneNo: '+919876500000', whatsappNo: '+919876500000', whatsappSameAsPhone: true, whatsappVerified: false, whatsappConsent: false }).where(eq(admissionTable.id, pending.id));
    const principalSession = await createSchoolStaffSession(schoolId, [{ role: 'principal' }]);
    principal = createTestClient(principalSession.session);
    principalId = principalSession.user.id;
    const coordinatorSession = await createSchoolStaffSession(schoolId, [{ role: 'exam_coordinator' }]);
    coordinatorId = coordinatorSession.user.id;
    const accountantSession = await createSchoolStaffSession(schoolId, [{ role: 'accountant' }]);
    accountant = createTestClient(accountantSession.session);
    accountantId = accountantSession.user.id;
    teacher = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [] } }])).session);
  });

  it('lists per-channel status by admission and bill run, resends a failed copy once and groups the run\'s failure alert', async () => {
    const { eventId } = await db.transaction((tx) =>
      notify(tx, {
        type: 'bill.issued',
        schoolId,
        key: `bill:delivery-log-test`,
        sendPriority: 'bulk',
        batch: { kind: 'billing_run', id: billRunId },
        recipients: { kind: 'admissions', admissionIds: [admissionId] },
        data: { ...billIssuedData(admissionId), billRunId },
      }),
    );
    // Until the worker fans the event out the log has no row for it and says one is still to come.
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'bill_run', billRunId } })).resolves.toMatchObject({
      items: [],
      preparation: { pendingCount: 1, failedCount: 0 },
    });
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'admission', admissionId } })).resolves.toMatchObject({ items: [], preparation: { pendingCount: 1 } });
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'bill_run', billRunId: 'frun_other' } })).resolves.toMatchObject({ preparation: { pendingCount: 0, failedCount: 0 } });
    await dispatch(eventId, whatsapp({ kind: 'failed', errorCode: 'wa_131026', definiteAnswer: true }));
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'bill_run', billRunId } })).resolves.toMatchObject({ preparation: { pendingCount: 0, failedCount: 0 } });

    await expect(teacher.school.listNotificationDeliveries({ schoolId, scope: { kind: 'admission', admissionId } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const byAdmission = await principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'admission', admissionId } });
    expect(byAdmission.pagination.totalItems).toBe(1);
    const [item] = byAdmission.items;
    expect(item).toMatchObject({ type: 'bill.issued', studentName: 'Test Student', reference: 'BILL/2026-27/000001', admissionId });
    expect(item).not.toHaveProperty('data');
    const failed = item!.deliveries.find((delivery) => delivery.channel === 'whatsapp')!;
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'wa_131026', resent: false, resendOfDeliveryId: null });
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'bill_run', billRunId } })).resolves.toMatchObject({ pagination: { totalItems: 1 } });
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'bill_run', billRunId: 'frun_other' } })).resolves.toMatchObject({ pagination: { totalItems: 0 } });
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'exam', sessionId: 'sess_test', examSlug: 'final' } })).resolves.toMatchObject({ pagination: { totalItems: 0 } });
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'admission', admissionId }, onlyFailed: true })).resolves.toMatchObject({ pagination: { totalItems: 1 } });

    // A billing run's failures are reported once, grouped, to the finance grant (principal, accountant; not the coordinator).
    await sweepWhatsAppFailureAlerts();
    await sweepWhatsAppFailureAlerts();
    const alerts = await db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, schoolId), eq(notificationEventTable.type, 'notification.whatsapp_batch_failed')));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ data: { batchKind: 'billing_run', billRunId, failedCount: 1, failedType: 'bill.issued', sessionId: 'sess_test' } });
    expect((alerts[0]!.recipients as { userIds: string[] }).userIds.sort()).toEqual([accountantId, principalId].sort());
    const single = await db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, schoolId), eq(notificationEventTable.type, 'notification.whatsapp_failed')));
    expect(single).toHaveLength(0);

    // Resend: permission-gated, once per failed delivery, a new delivery for the same notification.
    await expect(teacher.school.resendNotificationDelivery({ schoolId, deliveryId: failed.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(accountant.school.resendNotificationDelivery({ schoolId, deliveryId: failed.id })).resolves.toEqual({ created: true });
    await expect(accountant.school.resendNotificationDelivery({ schoolId, deliveryId: failed.id })).resolves.toEqual({ created: false });
    const [resendEvent] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.key, `resend:${failed.id}`));
    // A resend adds a copy to a listed notification; it is not a notification still to come.
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'admission', admissionId } })).resolves.toMatchObject({ preparation: { pendingCount: 0 } });
    const sender = whatsapp({ kind: 'sent', providerMessageId: 'wamid.resent' });
    await expect(dispatch(resendEvent!.id, sender)).resolves.toMatchObject({ status: 'dispatched', notificationCount: 0, owedDeliveryCount: 1 });
    expect(sender.available && sender.send).toHaveBeenCalledTimes(1);
    const after = await principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'admission', admissionId } });
    expect(after.items).toHaveLength(1);
    const whatsappCopies = after.items[0]!.deliveries.filter((delivery) => delivery.channel === 'whatsapp');
    expect(whatsappCopies).toEqual([
      expect.objectContaining({ id: failed.id, status: 'failed', resent: true }),
      expect.objectContaining({ status: 'sent', resendOfDeliveryId: failed.id, resent: false }),
    ]);
    // Only failed deliveries can be resent.
    await expect(accountant.school.resendNotificationDelivery({ schoolId, deliveryId: whatsappCopies[1]!.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(accountant.school.resendNotificationDelivery({ schoolId, deliveryId: 'ndl_unknown' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [original] = await db.select().from(notificationDeliveryTable).where(eq(notificationDeliveryTable.id, failed.id));
    expect(original!.failureAlertedAt).not.toBeNull();
  });

  it('alerts each one-off failure: finance to the finance grant, results never to accountants, and a single send also to its sender', async () => {
    const payment = await db.transaction((tx) =>
      notify(tx, {
        type: 'payment.received',
        schoolId,
        key: `payment:alert-${Date.now()}`,
        sendPriority: 'immediate',
        createdBy: accountantId,
        recipients: { kind: 'admissions', admissionIds: [admissionId] },
        data: { paymentId: 'fpay_alert', sessionId: 'sess_test', admissionId, receiptNumber: 'RCP/1', amountMinor: '100', currency: 'INR', receivedAt: new Date().toISOString(), studentName: 'Kavya Failed' },
      }),
    );
    await dispatch(payment.eventId, whatsapp({ kind: 'failed', errorCode: 'wa_131026', definiteAnswer: true }));
    const result = await db.transaction((tx) =>
      notify(tx, {
        type: 'exam.results_published',
        schoolId,
        key: `exam-result:alert-${Date.now()}`,
        sendPriority: 'immediate',
        createdBy: coordinatorId,
        alertCreatorOnFailure: true,
        recipients: { kind: 'admissions', admissionIds: [admissionId] },
        data: { sessionId: 'sess_test', examSlug: 'final', examName: 'Final', admissionId, studentId: 'stu_alert', classId: 'cls_alert', studentName: 'Kavya Failed' },
      }),
    );
    await dispatch(result.eventId, whatsapp({ kind: 'failed', errorCode: 'outcome_unknown', outcomeUnknown: true, definiteAnswer: false }));
    await sweepWhatsAppFailureAlerts();
    const alerts = await db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, schoolId), eq(notificationEventTable.type, 'notification.whatsapp_failed')));
    const byType = (failedType: string) => alerts.find((alert) => (alert.data as { failedType: string }).failedType === failedType)!;
    // The recorder of a payment did not ask for a send: only the grant is told.
    expect((byType('payment.received').recipients as { userIds: string[] }).userIds.sort()).toEqual([accountantId, principalId].sort());
    expect((byType('exam.results_published').recipients as { userIds: string[] }).userIds.sort()).toEqual([coordinatorId, principalId].sort());
  });

  it('fails a copy stranded in `sending` as outcome unknown, alerts it once and lets staff resend it', async () => {
    const emitPayment = (suffix: string) =>
      db.transaction((tx) =>
        notify(tx, {
          type: 'payment.received',
          schoolId,
          key: `payment:stuck-${suffix}-${Date.now()}`,
          sendPriority: 'immediate',
          recipients: { kind: 'admissions', admissionIds: [admissionId] },
          data: { paymentId: `fpay_stuck_${suffix}`, sessionId: 'sess_test', admissionId, receiptNumber: `RCP/S${suffix}`, amountMinor: '100', currency: 'INR', receivedAt: new Date().toISOString(), studentName: 'Kavya Failed' },
        }),
      );
    const owed = whatsapp({ kind: 'sent', providerMessageId: null });
    const claimAt = async (eventId: string, claimedAt: Date) => {
      await dispatchNow(eventId, { web_push: pushOff, whatsapp: owed });
      const [row] = await db
        .select({ id: notificationDeliveryTable.id })
        .from(notificationDeliveryTable)
        .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
        .where(and(eq(notificationTable.eventId, eventId), eq(notificationDeliveryTable.channel, 'whatsapp')));
      await db.update(notificationDeliveryTable).set({ status: 'sending', claimedAt, nextAttemptAt: null, attempts: 1 }).where(eq(notificationDeliveryTable.id, row!.id));
      return row!.id;
    };
    const now = new Date();
    const stuck = await claimAt((await emitPayment('old')).eventId, new Date(now.getTime() - STUCK_SENDING_MS - 60_000));
    const fresh = await claimAt((await emitPayment('new')).eventId, new Date(now.getTime() - 10 * 60_000));

    expect(await failStuckSendingDeliveries(db, now)).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.id, [stuck, fresh]));
    expect(rows.find((row) => row.id === stuck)).toMatchObject({ status: 'failed', errorCode: 'outcome_unknown', errorMessage: INTERRUPTED_SEND_MESSAGE.whatsapp, failedAt: now });
    expect(rows.find((row) => row.id === fresh)).toMatchObject({ status: 'sending', errorCode: null });

    const log = await principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'admission', admissionId } });
    const copy = log.items.flatMap((item) => item.deliveries).find((delivery) => delivery.id === stuck);
    expect(copy).toMatchObject({ status: 'failed', interrupted: false, resendable: true });

    await sweepWhatsAppFailureAlerts();
    const [alert] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.key, `whatsapp-failed:${stuck}`));
    expect(alert).toMatchObject({ type: 'notification.whatsapp_failed', data: { errorCode: 'outcome_unknown', errorMessage: INTERRUPTED_SEND_MESSAGE.whatsapp, failedType: 'payment.received' } });
    await expect(accountant.school.resendNotificationDelivery({ schoolId, deliveryId: stuck })).resolves.toEqual({ created: true });
    // The fresh claim is cleaned up so other tests' sweeps never fail it later.
    await db.update(notificationDeliveryTable).set({ status: 'failed', failedAt: now, errorCode: 'test', failureAlertedAt: now }).where(eq(notificationDeliveryTable.id, fresh));
  });

  it('filters admissions by WhatsApp readiness', async () => {
    const names = async (whatsappStatus: 'ready' | 'needs_attention' | 'no_number' | 'not_verified' | 'no_consent') =>
      (await principal.school.listAdmissions({ schoolId, filters: { whatsappStatus } })).items.map((item) => item.name);
    await expect(names('ready')).resolves.toEqual(['Kavya Failed']);
    await expect(names('needs_attention')).resolves.toEqual(['Rohan Pending']);
    await expect(names('not_verified')).resolves.toEqual(['Rohan Pending']);
    await expect(names('no_consent')).resolves.toEqual([]);
    await expect(names('no_number')).resolves.toEqual([]);
  });
});
