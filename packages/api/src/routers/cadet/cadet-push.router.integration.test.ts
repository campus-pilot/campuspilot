import { db } from '@campuspilot/db';
import { cadetPushSubscriptionTable } from '@campuspilot/db/schema/notification';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createCadetTestClient } from '../../../test/cadet';
import { expectRpcCode } from '../../../test/finance/assertions';
import { createTestAdmission, createTestSchool } from '../../../test/fixtures';
import { createCadetLogin, fakePushSubscription } from '../../../test/notifications';
import { MAX_ACTIVE_PUSH_SUBSCRIPTIONS } from '../../notifications/channels/web-push/subscriptions';

async function student(headers?: Headers) {
  const school = await createTestSchool();
  const admission = await createTestAdmission({ schoolId: school.id });
  return { school, admission, ...(await createCadetLogin(admission.id, headers)) };
}

describe('cadet web push subscriptions', () => {
  it('rejects anonymous callers', async () => {
    await expectRpcCode(createCadetTestClient(new Headers()).subscribePush(fakePushSubscription()), 'UNAUTHORIZED');
  });

  it('keeps the newest devices of a login and revokes the oldest beyond the cap', async () => {
    const { client, userId } = await student();
    const subscriptions = Array.from({ length: MAX_ACTIVE_PUSH_SUBSCRIPTIONS + 1 }, () => fakePushSubscription());
    for (const subscription of subscriptions) await client.subscribePush(subscription);
    const active = await db
      .select({ endpoint: cadetPushSubscriptionTable.endpoint })
      .from(cadetPushSubscriptionTable)
      .where(and(eq(cadetPushSubscriptionTable.cadetUserId, userId), isNull(cadetPushSubscriptionTable.revokedAt)));
    expect(active).toHaveLength(MAX_ACTIVE_PUSH_SUBSCRIPTIONS);
    expect(active.map((row) => row.endpoint)).not.toContain(subscriptions[0]!.endpoint);
    expect(await client.getPushSubscription({ endpoint: subscriptions[0]!.endpoint })).toEqual({ active: false });
    // Turning the oldest device on again makes it the newest; the next oldest goes.
    await client.subscribePush(subscriptions[0]!);
    expect(await client.getPushSubscription({ endpoint: subscriptions[0]!.endpoint })).toEqual({ active: true });
    expect(await client.getPushSubscription({ endpoint: subscriptions[1]!.endpoint })).toEqual({ active: false });
  });

  it('turns notifications on and off for this device and reports the state', async () => {
    const { client, userId } = await student(new Headers({ 'user-agent': 'TestBrowser/1.0' }));
    const subscription = fakePushSubscription();
    expect(await client.getPushSubscription({ endpoint: subscription.endpoint })).toEqual({ active: false });
    expect(await client.subscribePush(subscription)).toEqual({ active: true });
    expect(await client.getPushSubscription({ endpoint: subscription.endpoint })).toEqual({ active: true });
    const [row] = await db.select().from(cadetPushSubscriptionTable).where(eq(cadetPushSubscriptionTable.cadetUserId, userId));
    expect(row).toMatchObject({ endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, userAgent: 'TestBrowser/1.0', revokedAt: null });

    expect(await client.unsubscribePush({ endpoint: subscription.endpoint })).toEqual({ changed: true });
    expect(await client.unsubscribePush({ endpoint: subscription.endpoint })).toEqual({ changed: false });
    expect(await client.getPushSubscription({ endpoint: subscription.endpoint })).toEqual({ active: false });

    // Subscribing again re-activates the same row with the browser's new keys.
    const renewed = { ...fakePushSubscription(), endpoint: subscription.endpoint };
    await client.subscribePush(renewed);
    const rows = await db.select().from(cadetPushSubscriptionTable).where(eq(cadetPushSubscriptionTable.cadetUserId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row!.id, p256dh: renewed.keys.p256dh, revokedAt: null });
  });

  it('keeps siblings on one shared device separate', async () => {
    const first = await student();
    const sibling = await createCadetLogin((await createTestAdmission({ schoolId: first.school.id })).id);
    const subscription = fakePushSubscription();
    await first.client.subscribePush(subscription);
    await sibling.client.subscribePush(subscription);
    await sibling.client.unsubscribePush({ endpoint: subscription.endpoint });
    expect(await first.client.getPushSubscription({ endpoint: subscription.endpoint })).toEqual({ active: true });
    expect(await sibling.client.getPushSubscription({ endpoint: subscription.endpoint })).toEqual({ active: false });
  });

  it("returns the student's own school's public details", async () => {
    const { client, school } = await student();
    expect(await client.getSchool()).toEqual({ id: school.id, name: school.name, hasLogo: school.logoS3Key !== null });
  });

  it('refuses endpoints that are not a known push service (SSRF guard)', async () => {
    const { client } = await student();
    for (const endpoint of ['https://internal.example.com/push', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.test/x', 'https://fcm.googleapis.com:8443/x']) {
      await expectRpcCode(client.subscribePush({ ...fakePushSubscription(), endpoint }), 'BAD_REQUEST');
    }
  });
});
