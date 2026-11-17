import { db } from '@campuspilot/db';
import { notificationChannelRequiredFeatures, REMOTE_NOTIFICATION_CHANNELS } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { expectFeatureDisabled } from '../../test/feature-flags';
import {
  createAdminSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClient,
  createTestSchool,
  setTestSchoolFeature,
} from '../../test/fixtures';
import { billIssuedData, dispatchNow, drainSchool, emit } from '../../test/notifications';
import type { DeliverySendOutcome, NotificationChannelAdapter } from './channels';
import { forecastDeliveries, loadDispatchableEvent, planNotificationRows, resolveAdmissionRecipients } from './dispatch';
import { channelsWithoutFeature, disabledChannelFeatureOf, schoolDeliveryFacts } from './features';

/**
 * WhatsApp is a per-school feature (`whatsapp`, part of the Enterprise tier
 * or adjusted per school). A school without it sends nothing on WhatsApp:
 * the copy is `skipped: feature_disabled` when planned and again when sent,
 * a resend is refused and the forecast counts it as skipped, while the inbox
 * and web push are not affected.
 */

/** A WhatsApp adapter that is switched on for the platform and would send to anyone. */
function whatsappAdapter(outcome?: DeliverySendOutcome) {
  const decide = vi.fn(() => [{ status: 'owed' as const, destination: '+919876543210' }]);
  // A provider message id is unique per channel, so every accepted send gets its own.
  const send = vi.fn(async (): Promise<DeliverySendOutcome> => outcome ?? { kind: 'sent', providerMessageId: `wamid.${randomUUID()}` });
  return { adapter: { channel: 'whatsapp', available: true, decide, send } as NotificationChannelAdapter, decide, send };
}

/** A web push adapter that is switched on and has one device for every student. */
function webPushAdapter() {
  const send = vi.fn(async () => ({ kind: 'sent' as const, providerMessageId: null }));
  return {
    adapter: { channel: 'web_push', available: true, decide: () => [{ status: 'owed', destination: 'push_device_1' }], send } as NotificationChannelAdapter,
    send,
  };
}

async function deliveriesOf(eventId: string) {
  const notifications = await db.select().from(notificationTable).where(eq(notificationTable.eventId, eventId)).orderBy(asc(notificationTable.id));
  const deliveries = notifications.length
    ? await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.notificationId, notifications.map((row) => row.id)))
    : [];
  return {
    notifications,
    whatsapp: deliveries.filter((row) => row.channel === 'whatsapp'),
    webPush: deliveries.filter((row) => row.channel === 'web_push'),
  };
}

const emitBill = (schoolId: string, admissionId: string) =>
  emit({ type: 'bill.issued', data: billIssuedData(admissionId), schoolId, recipients: { kind: 'admissions', admissionIds: [admissionId] } });

describe('the whatsapp feature', () => {
  it('is the one feature a channel needs: WhatsApp needs `whatsapp`, web push needs none', () => {
    expect(Object.keys(notificationChannelRequiredFeatures).sort()).toEqual([...REMOTE_NOTIFICATION_CHANNELS].sort());
    expect(notificationChannelRequiredFeatures).toEqual({ web_push: [], whatsapp: ['whatsapp'] });
  });

  it('follows the school\'s tier and its adjustment', async () => {
    const [plus, pro, enterprise] = await Promise.all([
      createTestSchool({ tier: 'plus' }),
      createTestSchool({ tier: 'pro' }),
      createTestSchool({ tier: 'enterprise' }),
    ]);
    expect(await channelsWithoutFeature(db, plus.id)).toEqual(['whatsapp']);
    expect(await channelsWithoutFeature(db, pro.id)).toEqual(['whatsapp']);
    expect(await channelsWithoutFeature(db, enterprise.id)).toEqual([]);
    expect(await disabledChannelFeatureOf(db, pro.id, 'whatsapp')).toBe('whatsapp');
    expect(await disabledChannelFeatureOf(db, enterprise.id, 'whatsapp')).toBeNull();
    expect(await disabledChannelFeatureOf(db, pro.id, 'web_push')).toBeNull();

    // Switched on for a Pro school, off for an Enterprise school.
    await setTestSchoolFeature(pro.id, 'whatsapp', true);
    await setTestSchoolFeature(enterprise.id, 'whatsapp', false);
    expect(await channelsWithoutFeature(db, pro.id)).toEqual([]);
    expect(await channelsWithoutFeature(db, enterprise.id)).toEqual(['whatsapp']);
    // On a Plus school the switch alone is not enough: WhatsApp needs student management.
    await setTestSchoolFeature(plus.id, 'whatsapp', true);
    expect(await channelsWithoutFeature(db, plus.id)).toEqual(['whatsapp']);
    expect(await schoolDeliveryFacts(db, pro.id)).toEqual({ isDemoSchool: false, channelsWithoutFeature: [] });
    await expect(schoolDeliveryFacts(db, 'sch_missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a school without the whatsapp feature', () => {
  it('plans the WhatsApp copy as skipped: feature_disabled without asking the channel, and still writes the inbox row and the web push copy', async () => {
    const school = await createTestSchool({ tier: 'pro' });
    const admission = await createTestAdmission({ schoolId: school.id });
    const whatsapp = whatsappAdapter();
    const webPush = webPushAdapter();
    const adapters = { web_push: webPush.adapter, whatsapp: whatsapp.adapter };
    const { eventId } = await emitBill(school.id, admission.id);

    // The loaded event carries the fact, so a replayed fan-out keeps deciding the same way.
    expect(await loadDispatchableEvent(db, eventId)).toMatchObject({ disabledFeature: null, channelsWithoutFeature: ['whatsapp'] });

    expect(await dispatchNow(eventId, adapters)).toMatchObject({ status: 'dispatched', owedDeliveryCount: 1 });
    expect(whatsapp.decide).not.toHaveBeenCalled();
    const planned = await deliveriesOf(eventId);
    expect(planned.notifications).toHaveLength(1);
    expect(planned.whatsapp).toHaveLength(1);
    expect(planned.whatsapp[0]).toMatchObject({ status: 'skipped', skipReason: 'feature_disabled', destination: null, nextAttemptAt: null });
    expect(planned.webPush).toHaveLength(1);
    expect(planned.webPush[0]).toMatchObject({ status: 'owed', destination: 'push_device_1' });

    await drainSchool(school.id, { adapters });
    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(webPush.send).toHaveBeenCalledTimes(1);
    expect((await deliveriesOf(eventId)).webPush[0]).toMatchObject({ status: 'sent' });
  });

  it('sends on WhatsApp for a school that has the feature, by its tier or by an adjustment', async () => {
    const [enterprise, adjusted] = await Promise.all([createTestSchool({ tier: 'enterprise' }), createTestSchool({ tier: 'pro', features: ['whatsapp'] })]);
    for (const school of [enterprise, adjusted]) {
      const admission = await createTestAdmission({ schoolId: school.id });
      const whatsapp = whatsappAdapter();
      const adapters = { web_push: webPushAdapter().adapter, whatsapp: whatsapp.adapter };
      const { eventId } = await emitBill(school.id, admission.id);
      expect(await loadDispatchableEvent(db, eventId)).toMatchObject({ disabledFeature: null, channelsWithoutFeature: [] });
      await dispatchNow(eventId, adapters);
      await drainSchool(school.id, { adapters });
      expect(whatsapp.send).toHaveBeenCalledTimes(1);
      expect((await deliveriesOf(eventId)).whatsapp[0]).toMatchObject({ status: 'sent', destination: '+919876543210', attempts: 1 });
    }
  });

  it('reads an event journaled before the field existed as having every channel', () => {
    const recipient = { kind: 'staff_user' as const, id: 'user_1' };
    const whatsapp = whatsappAdapter();
    const adapters = { web_push: webPushAdapter().adapter, whatsapp: whatsapp.adapter };
    const event = { id: 'evt_old', type: 'bill.issued' as const, isDemoSchool: false, disabledFeature: null };
    const [before] = planNotificationRows(event, [recipient as never], adapters);
    expect(before!.deliveries.find((delivery) => delivery.channel === 'whatsapp')).toMatchObject({ status: 'owed' });
    const [after] = planNotificationRows({ ...event, channelsWithoutFeature: ['whatsapp'] }, [recipient as never], adapters);
    expect(after!.deliveries.find((delivery) => delivery.channel === 'whatsapp')).toMatchObject({ status: 'skipped', skipReason: 'feature_disabled' });
    expect(after!.deliveries.find((delivery) => delivery.channel === 'web_push')).toMatchObject({ status: 'owed' });
  });

  it('skips a copy that was queued while the school had the feature, when it is switched off before the send', async () => {
    const school = await createTestSchool({ tier: 'pro', features: ['whatsapp'] });
    const admission = await createTestAdmission({ schoolId: school.id });
    const whatsapp = whatsappAdapter();
    const webPush = webPushAdapter();
    const adapters = { web_push: webPush.adapter, whatsapp: whatsapp.adapter };
    const { eventId } = await emitBill(school.id, admission.id);
    expect(await dispatchNow(eventId, adapters)).toMatchObject({ status: 'dispatched', owedDeliveryCount: 2 });
    expect((await deliveriesOf(eventId)).whatsapp[0]).toMatchObject({ status: 'owed', destination: '+919876543210' });

    // Back to its tier, which has no WhatsApp.
    await setTestSchoolFeature(school.id, 'whatsapp', null);
    await drainSchool(school.id, { adapters });
    expect(whatsapp.send).not.toHaveBeenCalled();
    const after = await deliveriesOf(eventId);
    expect(after.whatsapp[0]).toMatchObject({ status: 'skipped', skipReason: 'feature_disabled', attempts: 0, nextAttemptAt: null });
    // The other channel of the same notification is not affected.
    expect(webPush.send).toHaveBeenCalledTimes(1);
    expect(after.webPush[0]).toMatchObject({ status: 'sent' });
  });

  it('skips a queued copy when the school moves to a tier without WhatsApp, and sends again after it moves back', async () => {
    const school = await createTestSchool({ tier: 'enterprise' });
    const admission = await createTestAdmission({ schoolId: school.id });
    const admin = createTestClient(await createAdminSession());
    const whatsapp = whatsappAdapter();
    const adapters = { web_push: { channel: 'web_push', available: false, unavailableReason: 'test' } as const, whatsapp: whatsapp.adapter };

    const queued = await emitBill(school.id, admission.id);
    await dispatchNow(queued.eventId, adapters);
    await admin.systemAdmin.updateSchoolTier({ id: school.id, tier: 'pro' });
    await drainSchool(school.id, { adapters });
    expect(whatsapp.send).not.toHaveBeenCalled();
    expect((await deliveriesOf(queued.eventId)).whatsapp[0]).toMatchObject({ status: 'skipped', skipReason: 'feature_disabled' });

    await admin.systemAdmin.updateSchoolTier({ id: school.id, tier: 'enterprise' });
    const next = await emitBill(school.id, admission.id);
    await dispatchNow(next.eventId, adapters);
    await drainSchool(school.id, { adapters });
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
    expect((await deliveriesOf(next.eventId)).whatsapp[0]).toMatchObject({ status: 'sent' });
    // What was skipped stays skipped: nothing is sent late.
    expect((await deliveriesOf(queued.eventId)).whatsapp[0]).toMatchObject({ status: 'skipped', skipReason: 'feature_disabled' });
  });

  it('refuses a staff resend of a failed WhatsApp copy with the disabled-feature error, and allows it once the school has the feature again', async () => {
    const school = await createTestSchool({ tier: 'pro', features: ['whatsapp'] });
    const admission = await createTestAdmission({ schoolId: school.id });
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    const failing = whatsappAdapter({ kind: 'failed', errorCode: 'wa_131026', definiteAnswer: true });
    const adapters = { web_push: { channel: 'web_push', available: false, unavailableReason: 'test' } as const, whatsapp: failing.adapter };
    const { eventId } = await emitBill(school.id, admission.id);
    await dispatchNow(eventId, adapters);
    await drainSchool(school.id, { adapters });
    const [failed] = (await deliveriesOf(eventId)).whatsapp;
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'wa_131026' });

    await setTestSchoolFeature(school.id, 'whatsapp', false);
    await expectFeatureDisabled(principal.school.resendNotificationDelivery({ schoolId: school.id, deliveryId: failed!.id }), 'whatsapp');
    expect(await db.select().from(notificationEventTable).where(eq(notificationEventTable.key, `resend:${failed!.id}`))).toEqual([]);

    await setTestSchoolFeature(school.id, 'whatsapp', true);
    await expect(principal.school.resendNotificationDelivery({ schoolId: school.id, deliveryId: failed!.id })).resolves.toEqual({ created: true });
  });

  it('counts the WhatsApp copies as skipped in the forecast shown before a send, and the other channel as before', async () => {
    const [without, withIt] = await Promise.all([createTestSchool({ tier: 'pro' }), createTestSchool({ tier: 'enterprise' })]);
    const adapters = { web_push: webPushAdapter().adapter, whatsapp: whatsappAdapter().adapter };
    const forecastFor = async (schoolId: string) => {
      const admissions = await Promise.all([createTestAdmission({ schoolId }), createTestAdmission({ schoolId })]);
      const recipients = await resolveAdmissionRecipients(db, schoolId, admissions.map((admission) => admission.id));
      return forecastDeliveries('bill.issued', await schoolDeliveryFacts(db, schoolId), recipients, adapters);
    };
    expect(await forecastFor(without.id)).toEqual({
      recipientCount: 2,
      channels: {
        web_push: { owed: 2, skipped: {} },
        whatsapp: { owed: 0, skipped: { feature_disabled: 2 } },
      },
    });
    expect(await forecastFor(withIt.id)).toEqual({
      recipientCount: 2,
      channels: {
        web_push: { owed: 2, skipped: {} },
        whatsapp: { owed: 2, skipped: {} },
      },
    });
  });
});
