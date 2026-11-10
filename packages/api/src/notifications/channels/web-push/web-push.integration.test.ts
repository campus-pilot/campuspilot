import { db } from '@campuspilot/db';
import { cadetSession } from '@campuspilot/db/schema/cadet';
import { cadetPushSubscriptionTable, notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { eq, inArray, isNotNull, and, sql } from 'drizzle-orm';
import { generateVAPIDKeys } from 'web-push';
import { describe, expect, it, vi } from 'vitest';

import { cadetAuth } from '@campuspilot/auth/cadet';
import { env } from '@campuspilot/env/server';

import { createCadetTestClient, signInCadet } from '../../../../test/cadet';
import { createAdmissionWithLogin } from '../../../../test/exam-results';
import { expectFeatureDisabled } from '../../../../test/feature-flags';
import { createSchoolStaffSession, createTestAdmission, createTestClient, createTestSchool, createTestUser, setTestSchoolFeature } from '../../../../test/fixtures';
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

  /**
   * Review round 1, F1: a signed-out device must stop receiving the
   * student's pushes, also while the school's Cadet Portal is switched off
   * (when every portal call, including the app's own "turn off", is refused).
   */
  describe('signing out stops the device, decided on the server', () => {
    const CADET_AUTH_URL = `${env.BETTER_AUTH_URL}/api/cadet/auth`;
    const signOut = (cookie: string) =>
      cadetAuth.handler(new Request(`${CADET_AUTH_URL}/sign-out`, { method: 'POST', headers: { cookie, origin: new URL(env.CADET_APP_URL).origin, 'content-type': 'application/json' }, body: '{}' }));
    const rowsOf = (endpoint: string) => db.select().from(cadetPushSubscriptionTable).where(eq(cadetPushSubscriptionTable.endpoint, endpoint));

    async function signedInStudent() {
      const school = await createTestSchool({ features: ['cadet'] });
      const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
      const { admission, credentials } = await createAdmissionWithLogin(principal, school.id, 'Push Student');
      const signIn = async () => {
        const { response, cookie } = await signInCadet(credentials);
        expect(response.status).toBe(200);
        return { cookie, client: createCadetTestClient(new Headers({ cookie })) };
      };
      return { school, admission, signIn };
    }

    it('revokes the subscriptions of the session that signs out, and only those, even with the portal switched off', async () => {
      const { school, admission, signIn } = await signedInStudent();
      // The same student on a shared phone and on a tablet: two sessions, two devices.
      const phone = await signIn();
      const tablet = await signIn();
      const phoneDevice = fakePushSubscription();
      const tabletDevice = fakePushSubscription();
      await phone.client.subscribePush(phoneDevice);
      await tablet.client.subscribePush(tabletDevice);
      const [phoneRow] = await rowsOf(phoneDevice.endpoint);
      const [tabletRow] = await rowsOf(tabletDevice.endpoint);
      expect(phoneRow!.cadetSessionId).toEqual(expect.any(String));
      expect(tabletRow!.cadetSessionId).not.toBe(phoneRow!.cadetSessionId);

      // The administrator switches the portal off; the phone then signs out.
      await setTestSchoolFeature(school.id, 'cadet', false);
      await expectFeatureDisabled(phone.client.getPushSubscription({ endpoint: phoneDevice.endpoint }), 'cadet');
      expect((await signOut(phone.cookie)).status).toBe(200);

      expect((await rowsOf(phoneDevice.endpoint))[0]!.revokedAt).toBeInstanceOf(Date);
      expect((await rowsOf(tabletDevice.endpoint))[0]!.revokedAt).toBeNull();
      // A bill posted afterwards reaches the tablet only, also once the portal is back on.
      await setTestSchoolFeature(school.id, 'cadet', true);
      const fetchMock = vi.fn<ChannelFetch>(async () => new Response(null, { status: 201 }));
      const { deliveries } = await dispatchBill(school.id, admission.id, fetchMock);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([tabletDevice.endpoint]);
      expect(deliveries).toHaveLength(1);
      // Signing out again, or without a session, changes nothing.
      expect((await signOut(phone.cookie)).status).toBe(200);
      expect((await rowsOf(tabletDevice.endpoint))[0]!.revokedAt).toBeNull();
    });

    it('lets the device be turned off while the portal is switched off, but not turned on', async () => {
      const { school, signIn } = await signedInStudent();
      const { client } = await signIn();
      const device = fakePushSubscription();
      await client.subscribePush(device);
      await setTestSchoolFeature(school.id, 'cadet', false);
      await expectFeatureDisabled(client.subscribePush(fakePushSubscription()), 'cadet');
      await expect(client.unsubscribePush({ endpoint: device.endpoint })).resolves.toEqual({ changed: true });
      expect((await rowsOf(device.endpoint))[0]!.revokedAt).toBeInstanceOf(Date);
      await expect(createCadetTestClient(new Headers()).unsubscribePush({ endpoint: device.endpoint })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('moves a device to the session that subscribes it again', async () => {
      const { signIn } = await signedInStudent();
      const first = await signIn();
      const second = await signIn();
      const device = fakePushSubscription();
      await first.client.subscribePush(device);
      await second.client.subscribePush(device);
      // The first session signing out no longer owns the device.
      await signOut(first.cookie);
      expect((await rowsOf(device.endpoint))[0]!.revokedAt).toBeNull();
      await signOut(second.cookie);
      expect((await rowsOf(device.endpoint))[0]!.revokedAt).toBeInstanceOf(Date);
    });
  });

  /**
   * Review round 2, R2B2: signing out is one of several ways a Cadet Portal
   * session ends. The device's subscription is revoked where the session row
   * is deleted (a trigger on `cadet_session`), so every path is covered,
   * including ones nobody has written yet.
   */
  describe('a session that ends by any path stops its device', () => {
    const CADET_AUTH_URL = `${env.BETTER_AUTH_URL}/api/cadet/auth`;
    const post = (path: string, cookie: string, body: object = {}) =>
      cadetAuth.handler(new Request(`${CADET_AUTH_URL}${path}`, { method: 'POST', headers: { cookie, origin: new URL(env.CADET_APP_URL).origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const rowOf = async (endpoint: string) => (await db.select().from(cadetPushSubscriptionTable).where(eq(cadetPushSubscriptionTable.endpoint, endpoint)))[0]!;
    const sessionOf = async (cookie: string) => (await cadetAuth.api.getSession({ headers: new Headers({ cookie }) }))?.session ?? null;

    /** One student signed in on a phone and a tablet, both with notifications on. */
    async function twoDevices() {
      const school = await createTestSchool({ features: ['cadet'] });
      const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
      const { admission, credentials } = await createAdmissionWithLogin(principal, school.id, 'Push Student');
      const signIn = async () => {
        const { response, cookie } = await signInCadet(credentials);
        expect(response.status).toBe(200);
        const device = fakePushSubscription();
        const client = createCadetTestClient(new Headers({ cookie }));
        await client.subscribePush(device);
        return { cookie, client, device };
      };
      return { school, principal, admission, phone: await signIn(), tablet: await signIn() };
    }

    it('revoke-sessions (sign out everywhere) stops every device of the student', async () => {
      const { school, admission, phone, tablet } = await twoDevices();
      expect((await post('/revoke-sessions', phone.cookie)).status).toBe(200);
      await expect(tablet.client.getPushSubscription({ endpoint: tablet.device.endpoint })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect((await rowOf(phone.device.endpoint)).revokedAt).toBeInstanceOf(Date);
      expect((await rowOf(tablet.device.endpoint)).revokedAt).toBeInstanceOf(Date);
      // Nothing is pushed to either signed-out device.
      const fetchMock = vi.fn<ChannelFetch>(async () => new Response(null, { status: 201 }));
      await dispatchBill(school.id, admission.id, fetchMock);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('revoke-other-sessions stops the other devices and keeps the caller subscribed', async () => {
      const { phone, tablet } = await twoDevices();
      expect((await post('/revoke-other-sessions', phone.cookie)).status).toBe(200);
      expect((await rowOf(tablet.device.endpoint)).revokedAt).toBeInstanceOf(Date);
      expect((await rowOf(phone.device.endpoint)).revokedAt).toBeNull();
      await expect(phone.client.getPushSubscription({ endpoint: phone.device.endpoint })).resolves.toEqual({ active: true });
    });

    it('revoke-session stops exactly the device of the session it names', async () => {
      const { phone, tablet } = await twoDevices();
      const tabletSession = await sessionOf(tablet.cookie);
      expect((await post('/revoke-session', phone.cookie, { token: tabletSession!.token })).status).toBe(200);
      expect((await rowOf(tablet.device.endpoint)).revokedAt).toBeInstanceOf(Date);
      expect((await rowOf(phone.device.endpoint)).revokedAt).toBeNull();
    });

    it('a staff password reset stops every device, also one whose subscription names no session', async () => {
      const { school, principal, admission, phone, tablet } = await twoDevices();
      // A subscription stored before sessions were recorded.
      await db.update(cadetPushSubscriptionTable).set({ cadetSessionId: null }).where(eq(cadetPushSubscriptionTable.endpoint, tablet.device.endpoint));
      await principal.school.issueAdmissionCadetPassword({ schoolId: school.id, admissionId: admission.id });
      expect((await rowOf(phone.device.endpoint)).revokedAt).toBeInstanceOf(Date);
      expect((await rowOf(tablet.device.endpoint)).revokedAt).toBeInstanceOf(Date);
    });

    it('cleaning up an expired session stops its device, whoever deletes the row', async () => {
      const { phone, tablet } = await twoDevices();
      const phoneSession = await sessionOf(phone.cookie);
      const tabletSession = await sessionOf(tablet.cookie);
      // Better Auth deletes an expired session when its cookie is next presented.
      await db.update(cadetSession).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(cadetSession.id, phoneSession!.id));
      const context = await cadetAuth.$context;
      await context.internalAdapter.deleteSession(phoneSession!.token);
      expect((await rowOf(phone.device.endpoint)).revokedAt).toBeInstanceOf(Date);
      expect((await rowOf(tablet.device.endpoint)).revokedAt).toBeNull();
      // A path that is not Better Auth at all (a maintenance job, a future feature): a plain delete.
      await db.delete(cadetSession).where(eq(cadetSession.id, tabletSession!.id));
      const row = await rowOf(tablet.device.endpoint);
      expect(row.revokedAt).toBeInstanceOf(Date);
      // The link is gone with the session; the revocation is what remains.
      expect(row.cadetSessionId).toBeNull();
    });

    it('finds the subscriptions of a deleted session through an index, revoked ones included (review round 3, R3B2)', async () => {
      // The foreign key's ON DELETE SET NULL looks rows up by session id alone. A partial
      // index (revoked_at is null) cannot serve that, and every session delete scanned the table.
      const result = await db.execute<{ indexdef: string }>(
        sql`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'cadet_push_subscription_session_idx'`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.indexdef).toContain('(cadet_session_id)');
      expect(result.rows[0]!.indexdef).not.toMatch(/\bWHERE\b/i);
    });
  });
});
