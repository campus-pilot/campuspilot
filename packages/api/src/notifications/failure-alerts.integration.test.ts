import { db } from '@campuspilot/db';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createSchoolStaffSession, createTestAdmission, createTestSchool } from '../../test/fixtures';
import { billIssuedData, dispatchNow } from '../../test/notifications';
import type { NotificationChannelAdapter } from './channels';
import { sweepWhatsAppFailureAlerts } from './failure-alerts';
import { notify } from './notify';
import { DAY_MS, QUICK_RETRY_HORIZON_MS } from './sender/retry-policy';

const pushOff: NotificationChannelAdapter = { channel: 'web_push', available: false, unavailableReason: 'test' };
const whatsappOwed: NotificationChannelAdapter = { channel: 'whatsapp', available: true, decide: () => [{ status: 'owed', destination: '+919800000000' }], send: vi.fn() };

describe('WhatsApp batch failure alerts (D-38)', () => {
  let schoolId: string;
  let admissionIds: string[];

  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: 'Batch Alert School' })).id;
    admissionIds = [(await createTestAdmission({ schoolId })).id, (await createTestAdmission({ schoolId })).id];
    await createSchoolStaffSession(schoolId, [{ role: 'principal' }]);
  });

  /** A billing run of one event for both students; returns its two WhatsApp copies (first student, second student). */
  async function billingRun() {
    const billRunId = `frun_${randomUUID().replaceAll('-', '').slice(0, 21)}`;
    const { eventId } = await db.transaction((tx) =>
      notify(tx, {
        type: 'bill.issued',
        schoolId,
        key: `bill:${billRunId}`,
        sendPriority: 'bulk',
        batch: { kind: 'billing_run', id: billRunId },
        recipients: { kind: 'admissions', admissionIds },
        data: { ...billIssuedData(admissionIds[0]!), billRunId },
      }),
    );
    await dispatchNow(eventId, { web_push: pushOff, whatsapp: whatsappOwed });
    const rows = await db
      .select({ id: notificationDeliveryTable.id, admissionId: notificationTable.admissionId })
      .from(notificationDeliveryTable)
      .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
      .where(and(eq(notificationTable.eventId, eventId), eq(notificationDeliveryTable.channel, 'whatsapp')));
    const byAdmission = (id: string) => rows.find((row) => row.admissionId === id)!.id;
    return { billRunId, failed: byAdmission(admissionIds[0]!), other: byAdmission(admissionIds[1]!) };
  }

  const fail = (id: string, failedAt = new Date()) =>
    db.update(notificationDeliveryTable).set({ status: 'failed', failedAt, nextAttemptAt: null, errorCode: 'wa_131026' }).where(eq(notificationDeliveryTable.id, id));
  const owe = (id: string, nextAttemptAt: Date) => db.update(notificationDeliveryTable).set({ nextAttemptAt }).where(eq(notificationDeliveryTable.id, id));
  const alertsOf = (billRunId: string) =>
    db
      .select()
      .from(notificationEventTable)
      .where(and(eq(notificationEventTable.schoolId, schoolId), eq(notificationEventTable.type, 'notification.whatsapp_batch_failed')))
      .then((events) => events.filter((event) => (event.data as { billRunId?: string }).billRunId === billRunId));

  it('alerts a batch once nothing is owed within the quick-retry horizon, and reports a day-later failure in a follow-up', async () => {
    const run = await billingRun();
    await fail(run.failed);

    // The other copy is due now (a quick retry or first send): the batch is still open.
    await sweepWhatsAppFailureAlerts();
    expect(await alertsOf(run.billRunId)).toHaveLength(0);
    // On a quick retry just inside the horizon: still open.
    await owe(run.other, new Date(Date.now() + QUICK_RETRY_HORIZON_MS - 60_000));
    await sweepWhatsAppFailureAlerts();
    expect(await alertsOf(run.billRunId)).toHaveLength(0);

    // Waiting for its day-later retry: the failure so far is alerted now.
    await owe(run.other, new Date(Date.now() + DAY_MS));
    await sweepWhatsAppFailureAlerts();
    const first = await alertsOf(run.billRunId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ data: { failedCount: 1 } });

    // The day-later retry fails too: one follow-up alert for it alone.
    await fail(run.other);
    await sweepWhatsAppFailureAlerts();
    await sweepWhatsAppFailureAlerts();
    const all = await alertsOf(run.billRunId);
    expect(all).toHaveLength(2);
    expect(all.map((alert) => (alert.data as { failedCount: number }).failedCount)).toEqual([1, 1]);
  });

  it('never lets open batches with older failures starve a settled one out of the sweep', async () => {
    // More open batches than one sweep handles, each with a failure older than the settled batch's.
    const open = [];
    for (let index = 0; index < 51; index += 1) {
      const run = await billingRun();
      await fail(run.failed, new Date('2020-01-01T00:00:00Z'));
      open.push(run);
    }
    const settled = await billingRun();
    await fail(settled.failed);
    await fail(settled.other);

    await sweepWhatsAppFailureAlerts();
    expect(await alertsOf(settled.billRunId)).toEqual([expect.objectContaining({ data: expect.objectContaining({ failedCount: 2 }) })]);
    const openFailures = await db.select({ alertedAt: notificationDeliveryTable.failureAlertedAt }).from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.id, open.map((run) => run.failed)));
    expect(openFailures.every((row) => row.alertedAt === null)).toBe(true);

    // Clean up: settle the open batches, so other files' sweeps are not left with them.
    await db.update(notificationDeliveryTable).set({ status: 'skipped', skipReason: 'disabled', nextAttemptAt: null }).where(inArray(notificationDeliveryTable.id, open.map((run) => run.other)));
    await sweepWhatsAppFailureAlerts();
  });
});
