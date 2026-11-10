import { db } from '@campuspilot/db';
import { cadetPushSubscriptionTable, notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { eq, inArray, isNotNull, and } from 'drizzle-orm';
import { generateVAPIDKeys } from 'web-push';
import { describe, expect, it, vi } from 'vitest';

import { createTestAdmission, createTestSchool, createTestUser } from '../../../../test/fixtures';
import { billIssuedData, createCadetLogin, dispatchNow, drainSchool, fakePushSubscription } from '../../../../test/notifications';
import { notify } from '../../notify';
import { resendFailedDelivery } from '../../redelivery';
import { WEB_PUSH_QUICK_RETRY_LIMIT } from '../../sender/retry-policy';
import type { ChannelFetch, NotificationChannelAdapter } from '../types';
import { createWebPushAdapter } from './adapter';

const vapid = { ...generateVAPIDKeys(), subject: 'mailto:ops@campuspilot.test' };
const whatsappOff = { channel: 'whatsapp', available: false, unavailableReason: 'test' } as const;

/** A school, an admission with a Cadet login, and that login's subscriptions. */
async function subscribedStudent(subscriptionCount = 1) {
  const school = await createTestSchool({ features: ['cadet'] });
  const admission = await createTestAdmission({ schoolId: school.id });
  const { client } = await createCadetLogin(admission.id);
  const subscriptions = [];
  for (let index = 0; index < subscriptionCount; index += 1) {
    const subscription = fakePushSubscription();
    await client.subscribePush(subscription);
    subscriptions.push(subscription);
  }
  return { school, admission, subscriptions };
}

async function dispatchBill(schoolId: string, admissionId: string, fetchMock: ChannelFetch) {
  const adapters = { web_push: createWebPushAdapter({ vapid, fetch: fetchMock }) as NotificationChannelAdapter, whatsapp: whatsappOff };
  const { eventId } = await db.transaction((tx) =>
    notify(tx, { sendPriority: 'immediate', type: 'bill.issued', data: billIssuedData(admissionId, { billNumber: 'BILL/9' }), schoolId, recipients: { kind: 'admissions', admissionIds: [admissionId] }, key: `bill:${crypto.randomUUID()}` }),
  );
  const result = await dispatchNow(eventId, adapters);
  const { waits, sleeps } = await drainSchool(schoolId, { adapters });
  const [notification] = await db.select().from(notificationTable).where(eq(notificationTable.eventId, eventId));
  const deliveries = await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.notificationId, [notification!.id]));
  return { result, waits, sleeps, notification: notification!, deliveries: deliveries.filter((row) => row.channel === 'web_push') };
}

describe('web push channel', () => {
  it('sends an encrypted, VAPID-signed push to every active subscription', async () => {
    const { school, admission, subscriptions } = await subscribedStudent(2);
    const fetchMock = vi.fn<ChannelFetch>(async () => new Response(null, { status: 201 }));
    const { deliveries, notification } = await dispatchBill(school.id, admission.id, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(subscriptions.map((subscription) => subscription.endpoint).sort());
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.TTL).toBe(String(3 * 24 * 60 * 60));
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('content-length');
    // The payload is encrypted: no fact appears in clear text.
    expect(Buffer.from(init.body as Uint8Array).toString('latin1')).not.toContain('BILL/9');

    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((row) => row.status === 'sent' && row.attempts === 1)).toBe(true);
    expect(deliveries.every((row) => row.notificationId === notification.id)).toBe(true);
    const stored = await db.select().from(cadetPushSubscriptionTable).where(inArray(cadetPushSubscriptionTable.endpoint, subscriptions.map((s) => s.endpoint)));
    expect(stored.every((row) => row.lastSuccessAt instanceof Date)).toBe(true);
  });

  it('records skipped: no_subscription when the student has no active device', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const fetchMock = vi.fn<ChannelFetch>();
    const { deliveries } = await dispatchBill(school.id, admission.id, fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deliveries).toEqual([expect.objectContaining({ status: 'skipped', skipReason: 'no_subscription', destination: null })]);
  });

  it('revokes a subscription the push service reports gone (404/410) and never retries it', async () => {
    for (const status of [404, 410]) {
      const { school, admission, subscriptions } = await subscribedStudent();
      const fetchMock = vi.fn<ChannelFetch>(async () => new Response(null, { status }));
      const { deliveries, waits } = await dispatchBill(school.id, admission.id, fetchMock);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(waits).toEqual([]);
      expect(deliveries[0]).toMatchObject({ status: 'failed', errorCode: 'subscription_gone' });
      const [row] = await db.select().from(cadetPushSubscriptionTable).where(eq(cadetPushSubscriptionTable.endpoint, subscriptions[0]!.endpoint));
      expect(row!.revokedAt).toBeInstanceOf(Date);
    }
  });

  it('retries 429 no sooner than its Retry-After, then sends', async () => {
    const { school, admission } = await subscribedStudent();
    const fetchMock = vi
      .fn<ChannelFetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '600' } }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const { deliveries, waits } = await dispatchBill(school.id, admission.id, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([600_000]);
    expect(deliveries[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('gives up after the bounded number of attempts on persistent 5xx and records failed', async () => {
    const { school, admission } = await subscribedStudent();
    const fetchMock = vi.fn<ChannelFetch>(async () => new Response(null, { status: 503 }));
    const { deliveries, waits } = await dispatchBill(school.id, admission.id, fetchMock);
    // Quick retries only (1, 4, 16, 64, 256 min); push is never retried a day later.
    expect(fetchMock).toHaveBeenCalledTimes(WEB_PUSH_QUICK_RETRY_LIMIT + 1);
    expect(waits).toEqual([60_000, 240_000, 960_000, 3_840_000, 15_360_000]);
    expect(deliveries[0]).toMatchObject({ status: 'failed', errorCode: 'http_503', errorMessage: 'Gave up after the last retry.', attempts: WEB_PUSH_QUICK_RETRY_LIMIT + 1 });
  });

  it('fails permanently on other 4xx (e.g. a VAPID key mismatch) without retrying', async () => {
    const { school, admission } = await subscribedStudent();
    const fetchMock = vi.fn<ChannelFetch>(async () => new Response(null, { status: 403 }));
    const { deliveries, waits } = await dispatchBill(school.id, admission.id, fetchMock);
    expect(waits).toEqual([]);
    expect(deliveries[0]).toMatchObject({ status: 'failed', errorCode: 'http_403', attempts: 1 });
  });

  it('treats network errors as transient', async () => {
    const { school, admission } = await subscribedStudent();
    const fetchMock = vi
      .fn<ChannelFetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const { deliveries } = await dispatchBill(school.id, admission.id, fetchMock);
    expect(deliveries[0]).toMatchObject({ status: 'sent', attempts: 2, errorCode: null });
  });

  it('resends a failed push to the device that missed it only, and refuses when that device is gone (D-40)', async () => {
    const { school, admission, subscriptions } = await subscribedStudent(2);
    const [first] = await db.select().from(cadetPushSubscriptionTable).where(eq(cadetPushSubscriptionTable.endpoint, subscriptions[0]!.endpoint));
    // The first device fails transiently until its retries run out; the second gets it.
    const failing = vi.fn<ChannelFetch>(async (url) => new Response(null, { status: String(url).includes(subscriptions[0]!.endpoint.split('/').pop()!) ? 503 : 201 }));
    const { deliveries } = await dispatchBill(school.id, admission.id, failing);
    const failed = deliveries.find((row) => row.destination === first!.id)!;
    expect(failed.status).toBe('failed');

    const adapters = { web_push: createWebPushAdapter({ vapid, fetch: vi.fn<ChannelFetch>(async () => new Response(null, { status: 201 })) }) as NotificationChannelAdapter, whatsapp: whatsappOff };
    const staff = await createTestUser();
    const resend = await resendFailedDelivery({ schoolId: school.id, deliveryId: failed.id, requestedBy: staff.id });
    await dispatchNow(resend.eventId, adapters);
    await drainSchool(school.id, { adapters });
    const resent = await db.select().from(notificationDeliveryTable).where(eq(notificationDeliveryTable.resendOfDeliveryId, failed.id));
    expect(resent).toEqual([expect.objectContaining({ channel: 'web_push', destination: first!.id, status: 'sent' })]);

    // A gone device: the push service said so, nothing is sent.
    const gone = await subscribedStudent(1);
    const { deliveries: goneDeliveries } = await dispatchBill(gone.school.id, gone.admission.id, vi.fn<ChannelFetch>(async () => new Response(null, { status: 410 })));
    await expect(resendFailedDelivery({ schoolId: gone.school.id, deliveryId: goneDeliveries[0]!.id, requestedBy: staff.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    const revoked = await db.select().from(cadetPushSubscriptionTable).where(and(eq(cadetPushSubscriptionTable.endpoint, gone.subscriptions[0]!.endpoint), isNotNull(cadetPushSubscriptionTable.revokedAt)));
    expect(revoked).toHaveLength(1);
  });
});
