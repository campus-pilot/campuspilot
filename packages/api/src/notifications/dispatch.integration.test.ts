import { db } from '@campuspilot/db';
import {
  notificationDeliveryTable,
  notificationEventTable,
  notificationTable,
} from '@campuspilot/db/schema/notification';
import { asc, eq, inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  createTestAdmission,
  createTestSchool,
  createTestSchoolMember,
  createTestUser,
} from '../../test/fixtures';
import { billIssuedData, billingRunPostedData, dispatchNow, emitAndDispatch } from '../../test/notifications';
import type { NotificationChannelAdapter } from './channels';
import {
  insertNotificationChunk,
  loadDispatchableEvent,
  planNotificationRows,
  resolveNotificationRecipients,
  runNotificationDispatch,
} from './dispatch';
import { notificationRowId } from './ids';
import { notify, NotifyError } from './notify';

async function staffMember(schoolId: string) {
  const member = await createTestUser();
  await createTestSchoolMember({ schoolId, userId: member.id, roles: [] });
  return member;
}

async function rowsOf(eventId: string) {
  const notifications = await db.select().from(notificationTable).where(eq(notificationTable.eventId, eventId)).orderBy(asc(notificationTable.id));
  const deliveries = notifications.length
    ? await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.notificationId, notifications.map((row) => row.id)))
    : [];
  return { notifications, deliveries };
}

describe('notify()', () => {
  it('writes exactly one outbox event and returns the same event for a repeated key', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const input = {
      type: 'bill.issued' as const,
      data: billIssuedData(admission.id),
      schoolId: school.id,
      recipients: { kind: 'admissions' as const, admissionIds: [admission.id, admission.id] },
      key: 'bill:one',
    };
    const first = await db.transaction((tx) => notify(tx, input));
    const replay = await db.transaction((tx) => notify(tx, input));
    expect(first.created).toBe(true);
    expect(replay).toEqual({ eventId: first.eventId, created: false });
    const events = await db.select().from(notificationEventTable).where(eq(notificationEventTable.schoolId, school.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'pending', type: 'bill.issued', recipients: { kind: 'admissions', admissionIds: [admission.id] } });
  });

  it('rolls back with the business transaction', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    await expect(
      db.transaction(async (tx) => {
        await notify(tx, { type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] }, key: 'bill:rolled-back' });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    expect(await db.select().from(notificationEventTable).where(eq(notificationEventTable.schoolId, school.id))).toHaveLength(0);
  });

  it('refuses invalid facts and recipients of the wrong audience', async () => {
    const school = await createTestSchool();
    await expect(
      db.transaction((tx) =>
        notify(tx, {
          type: 'bill.issued',
          data: { ...billIssuedData('adm'), totalAmountMinor: '-1' },
          schoolId: school.id,
          recipients: { kind: 'admissions', admissionIds: ['adm'] },
          key: 'bad-facts',
        }),
      ),
    ).rejects.toBeInstanceOf(NotifyError);
    await expect(
      db.transaction((tx) =>
        notify(tx, {
          type: 'billing.run_posted',
          data: billingRunPostedData(),
          schoolId: school.id,
          // A staff type addressed to admissions is a programming error.
          recipients: { kind: 'admissions', admissionIds: ['adm'] } as never,
          key: 'bad-audience',
        }),
      ),
    ).rejects.toThrow(/staff_user/);
  });
});

describe('notification dispatch', () => {
  it('writes one inbox row per qualifying staff member, with no remote deliveries', async () => {
    const school = await createTestSchool();
    const otherSchool = await createTestSchool();
    const member = await staffMember(school.id);
    const outsider = await staffMember(otherSchool.id);
    const { eventId, result } = await emitAndDispatch({
      type: 'billing.run_posted',
      data: billingRunPostedData(),
      schoolId: school.id,
      recipients: { kind: 'staff_users', userIds: [member.id, outsider.id] },
      createdBy: member.id,
    });
    expect(result).toEqual({ status: 'dispatched', notificationCount: 1, owedDeliveryCount: 0 });
    const { notifications, deliveries } = await rowsOf(eventId);
    expect(notifications).toEqual([
      expect.objectContaining({
        id: notificationRowId(eventId, { kind: 'staff_user', id: member.id }),
        recipientKind: 'staff_user',
        userId: member.id,
        admissionId: null,
        schoolId: school.id,
        type: 'billing.run_posted',
        readAt: null,
      }),
    ]);
    expect(deliveries).toEqual([]);
    const [event] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.id, eventId));
    expect(event).toMatchObject({ status: 'dispatched', notificationCount: 1 });
  });

  it('records each student copy on unavailable channels as skipped: disabled, never as sent', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const foreign = await createTestAdmission({ schoolId: (await createTestSchool()).id });
    const { eventId } = await emitAndDispatch({
      type: 'bill.issued',
      data: billIssuedData(admission.id),
      schoolId: school.id,
      recipients: { kind: 'admissions', admissionIds: [admission.id, foreign.id] },
    });
    const { notifications, deliveries } = await rowsOf(eventId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ recipientKind: 'admission', admissionId: admission.id, userId: null });
    expect(deliveries.map(({ channel, status, skipReason, destination }) => ({ channel, status, skipReason, destination })).sort((a, b) => a.channel.localeCompare(b.channel))).toEqual([
      { channel: 'web_push', status: 'skipped', skipReason: 'disabled', destination: null },
      { channel: 'whatsapp', status: 'skipped', skipReason: 'disabled', destination: null },
    ]);
  });

  it('is idempotent: a replayed fan-out adds no rows and keeps read state', async () => {
    const school = await createTestSchool();
    const members = await Promise.all([staffMember(school.id), staffMember(school.id)]);
    const { eventId } = await emitAndDispatch({
      type: 'billing.run_posted',
      data: billingRunPostedData(),
      schoolId: school.id,
      recipients: { kind: 'staff_users', userIds: members.map((member) => member.id) },
    });
    const before = await rowsOf(eventId);
    await db.update(notificationTable).set({ readAt: new Date() }).where(eq(notificationTable.id, before.notifications[0]!.id));

    // Replay of the insert step after its commit (the journal missed it).
    const event = await db.select().from(notificationEventTable).where(eq(notificationEventTable.id, eventId));
    await db.update(notificationEventTable).set({ status: 'pending' }).where(eq(notificationEventTable.id, eventId));
    const loaded = (await loadDispatchableEvent(db, eventId))!;
    const planned = planNotificationRows(loaded, await resolveNotificationRecipients(db, loaded));
    expect(planned.map((row) => row.id).sort()).toEqual(before.notifications.map((row) => row.id).sort());
    expect(await insertNotificationChunk(loaded, planned)).toBe('inserted');
    // And a whole second dispatch of the same event.
    expect(await dispatchNow(eventId)).toMatchObject({ status: 'dispatched', notificationCount: 2 });

    const after = await rowsOf(eventId);
    expect(after.notifications).toHaveLength(2);
    expect(after.notifications.find((row) => row.id === before.notifications[0]!.id)!.readAt).toBeInstanceOf(Date);
    expect(event).toHaveLength(1);
  });

  it('does nothing for an event that is no longer pending', async () => {
    const school = await createTestSchool();
    const member = await staffMember(school.id);
    const { eventId } = await emitAndDispatch({
      type: 'billing.run_posted',
      data: billingRunPostedData(),
      schoolId: school.id,
      recipients: { kind: 'staff_users', userIds: [member.id] },
    });
    expect(await dispatchNow(eventId)).toEqual({ status: 'skipped' });
    expect((await rowsOf(eventId)).notifications).toHaveLength(1);
  });

  it('inserts nothing once the event is gone (demo school purged mid-dispatch)', async () => {
    const school = await createTestSchool();
    const member = await staffMember(school.id);
    const { eventId } = await db.transaction((tx) =>
      notify(tx, { type: 'billing.run_posted', data: billingRunPostedData(), schoolId: school.id, recipients: { kind: 'staff_users', userIds: [member.id] }, key: 'gone' }),
    );
    const loaded = (await loadDispatchableEvent(db, eventId))!;
    const planned = planNotificationRows(loaded, await resolveNotificationRecipients(db, loaded));
    await db.delete(notificationEventTable).where(eq(notificationEventTable.id, eventId));
    expect(await insertNotificationChunk(loaded, planned)).toBe('event_gone');
    expect(await db.select().from(notificationTable).where(eq(notificationTable.eventId, eventId))).toHaveLength(0);
  });

  it('claims an owed delivery once and records the provider outcome (available channel)', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const send = vi.fn(async () => ({ kind: 'sent' as const, providerMessageId: 'wamid.test' }));
    const whatsapp: NotificationChannelAdapter = {
      channel: 'whatsapp',
      available: true,
      decide: () => [{ status: 'owed', destination: '+919876543210' }],
      send,
    };
    const adapters = { web_push: { channel: 'web_push', available: false, unavailableReason: 'test' } as const, whatsapp };
    const { eventId } = await db.transaction((tx) =>
      notify(tx, { type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] }, key: 'owed' }),
    );
    const step = <T,>(_name: string, action: () => Promise<T>) => action();
    expect(await runNotificationDispatch({ eventId, step, sleep: async () => undefined, adapters })).toMatchObject({ status: 'dispatched', owedDeliveryCount: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const { deliveries } = await rowsOf(eventId);
    expect(deliveries.find((row) => row.channel === 'whatsapp')).toMatchObject({ status: 'sent', providerMessageId: 'wamid.test', attempts: 1, destination: '+919876543210' });

    // A replay of the whole dispatch never sends twice.
    await db.update(notificationEventTable).set({ status: 'pending' }).where(eq(notificationEventTable.id, eventId));
    await runNotificationDispatch({ eventId, step, sleep: async () => undefined, adapters });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('skips remote copies of demo schools before asking the channel', async () => {
    const school = await createTestSchool({ isDemo: true });
    const admission = await createTestAdmission({ schoolId: school.id });
    const decide = vi.fn(() => [{ status: 'owed' as const, destination: '+919876543210' }]);
    const adapters = {
      web_push: { channel: 'web_push', available: false, unavailableReason: 'test' } as const,
      whatsapp: { channel: 'whatsapp', available: true, decide, send: vi.fn() } as NotificationChannelAdapter,
    };
    const { eventId } = await db.transaction((tx) =>
      notify(tx, { type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] }, key: 'demo' }),
    );
    await runNotificationDispatch({ eventId, step: (_name, action) => action(), sleep: async () => undefined, adapters });
    expect(decide).not.toHaveBeenCalled();
    const { deliveries } = await rowsOf(eventId);
    expect(deliveries.find((row) => row.channel === 'whatsapp')).toMatchObject({ status: 'skipped', skipReason: 'demo_school' });
    expect(deliveries.find((row) => row.channel === 'web_push')).toMatchObject({ status: 'skipped', skipReason: 'disabled' });
  });
});
