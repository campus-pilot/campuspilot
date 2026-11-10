import { db } from '@campuspilot/db';
import { notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { expectRpcCode } from '../../../../test/finance/assertions';
import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClient,
  createTestSchool,
  createTestSchoolMember,
} from '../../../../test/fixtures';
import { billIssuedData, billingRunPostedData, emitAndDispatch } from '../../../../test/notifications';
import { notificationRowId } from '../../../notifications/ids';

async function staffInbox(count = 1) {
  const school = await createTestSchool();
  const staff = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: null }]);
  const eventIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const { eventId } = await emitAndDispatch({
      type: 'billing.run_posted',
      data: billingRunPostedData(index + 1),
      schoolId: school.id,
      recipients: { kind: 'staff_users', userIds: [staff.user.id] },
    });
    eventIds.push(eventId);
  }
  const ids = eventIds.map((eventId) => notificationRowId(eventId, { kind: 'staff_user', id: staff.user.id }));
  return { school, staff, client: createTestClient(staff.session), ids };
}

/** Pins a row's creation time so ordering is deterministic. */
async function setCreatedAt(id: string, createdAt: Date) {
  await db.update(notificationTable).set({ createdAt }).where(eq(notificationTable.id, id));
}

describe('staff notification inbox', () => {
  it('requires a session and current membership of the school', async () => {
    const { school } = await staffInbox();
    await expectRpcCode(createTestClient(null).school.getUnreadNotificationCount({ schoolId: school.id }), 'UNAUTHORIZED');
    const outsider = await createSchoolStaffSession((await createTestSchool()).id, [{ role: 'principal', meta: null }]);
    await expectRpcCode(createTestClient(outsider.session).school.listNotifications({ schoolId: school.id }), 'FORBIDDEN');
  });

  it('needs no permission: a member without roles reads their own inbox', async () => {
    const school = await createTestSchool();
    const member = await createSchoolStaffSession(school.id, []);
    await emitAndDispatch({
      type: 'billing.run_posted',
      data: billingRunPostedData(),
      schoolId: school.id,
      recipients: { kind: 'staff_users', userIds: [member.user.id] },
    });
    const client = createTestClient(member.session);
    expect(await client.school.getUnreadNotificationCount({ schoolId: school.id })).toEqual({ count: 1 });
  });

  it('shows only the viewer’s own rows of that school, as facts without delivery status', async () => {
    const { school, staff, client, ids } = await staffInbox();
    // A colleague's row in the same school and the viewer's row in another school.
    const colleague = await createSchoolStaffSession(school.id, []);
    await emitAndDispatch({ type: 'billing.run_posted', data: billingRunPostedData(), schoolId: school.id, recipients: { kind: 'staff_users', userIds: [colleague.user.id] } });
    const otherSchool = await createTestSchool();
    await createTestSchoolMember({ schoolId: otherSchool.id, userId: staff.user.id, roles: [] });
    await emitAndDispatch({ type: 'billing.run_posted', data: billingRunPostedData(), schoolId: otherSchool.id, recipients: { kind: 'staff_users', userIds: [staff.user.id] } });

    const page = await client.school.listNotifications({ schoolId: school.id });
    expect(page.items.map((item) => item.id)).toEqual(ids);
    expect(Object.keys(page.items[0]!).sort()).toEqual(['createdAt', 'data', 'id', 'readAt', 'type']);
    expect(page.items[0]).toMatchObject({ type: 'billing.run_posted', readAt: null, data: { billCount: 1 } });
    expect(page.nextCursor).toBeNull();
    expect(await client.school.getUnreadNotificationCount({ schoolId: otherSchool.id })).toEqual({ count: 1 });
  });

  it('never shows rows of unknown (retired) types or of the student audience', async () => {
    const { school, staff, client, ids } = await staffInbox();
    const [event] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.schoolId, school.id));
    await db.insert(notificationTable).values({
      id: 'ntf_retired00000000000000',
      eventId: event!.id,
      schoolId: school.id,
      recipientKind: 'staff_user',
      userId: staff.user.id,
      type: 'retired.type',
      data: {},
    });
    const admission = await createTestAdmission({ schoolId: school.id });
    await emitAndDispatch({ type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] } });

    expect((await client.school.listNotifications({ schoolId: school.id })).items.map((item) => item.id)).toEqual(ids);
    expect(await client.school.getUnreadNotificationCount({ schoolId: school.id })).toEqual({ count: 1 });
    expect(await client.school.markNotificationsRead({ schoolId: school.id, ids: ['ntf_retired00000000000000'] })).toEqual({ changed: 0 });
  });

  it('pages newest first with a keyset cursor, ties broken by ID', async () => {
    const { school, client, ids } = await staffInbox(3);
    const tie = new Date('2026-11-01T10:00:00.000Z');
    await setCreatedAt(ids[0]!, new Date('2026-11-01T09:00:00.000Z'));
    await setCreatedAt(ids[1]!, tie);
    await setCreatedAt(ids[2]!, tie);
    const newestFirst = [...ids.slice(1)].sort().reverse().concat(ids[0]!);

    const first = await client.school.listNotifications({ schoolId: school.id, limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(newestFirst.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    const second = await client.school.listNotifications({ schoolId: school.id, limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.id)).toEqual(newestFirst.slice(2));
    expect(second.nextCursor).toBeNull();
    await expectRpcCode(client.school.listNotifications({ schoolId: school.id, cursor: 'page-2' }), 'BAD_REQUEST');
    await expectRpcCode(client.school.listNotifications({ schoolId: school.id, limit: 21 }), 'BAD_REQUEST');
  });

  it('pages rows that differ only in microseconds without skipping any', async () => {
    const { school, client, ids } = await staffInbox(3);
    // Same millisecond, different microseconds (as one fan-out writes them).
    const micro = ['2026-11-01T10:00:00.123100Z', '2026-11-01T10:00:00.123400Z', '2026-11-01T10:00:00.123700Z'];
    for (const [index, id] of ids.entries()) {
      await db.execute(sql`update notification set created_at = ${micro[index]}::timestamptz where id = ${id}`);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const result = await client.school.listNotifications({ schoolId: school.id, limit: 1, ...(cursor ? { cursor } : {}) });
      seen.push(...result.items.map((item) => item.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual([...ids].reverse());
  });

  it('marks read only the viewer’s rows and filters unread', async () => {
    const { school, client, ids } = await staffInbox(2);
    const colleague = await createSchoolStaffSession(school.id, []);
    const { eventId } = await emitAndDispatch({ type: 'billing.run_posted', data: billingRunPostedData(), schoolId: school.id, recipients: { kind: 'staff_users', userIds: [colleague.user.id] } });
    const colleagueRow = notificationRowId(eventId, { kind: 'staff_user', id: colleague.user.id });

    expect(await client.school.markNotificationsRead({ schoolId: school.id, ids: [ids[0]!, colleagueRow] })).toEqual({ changed: 1 });
    expect(await client.school.markNotificationsRead({ schoolId: school.id, ids: [ids[0]!] })).toEqual({ changed: 0 });
    const [colleagueState] = await db.select({ readAt: notificationTable.readAt }).from(notificationTable).where(eq(notificationTable.id, colleagueRow));
    expect(colleagueState!.readAt).toBeNull();
    const unread = await client.school.listNotifications({ schoolId: school.id, filter: 'unread' });
    expect(unread.items.map((item) => item.id)).toEqual([ids[1]]);
    expect(await client.school.getUnreadNotificationCount({ schoolId: school.id })).toEqual({ count: 1 });
    await expectRpcCode(client.school.markNotificationsRead({ schoolId: school.id, ids: [] }), 'BAD_REQUEST');
  });

  it('marks all read only up to `before`, clamped to the server clock', async () => {
    const { school, client, ids } = await staffInbox(2);
    await setCreatedAt(ids[0]!, new Date('2026-11-01T09:00:00.000Z'));
    await setCreatedAt(ids[1]!, new Date('2026-11-01T11:00:00.000Z'));
    expect(await client.school.markAllNotificationsRead({ schoolId: school.id, before: '2026-11-01T10:00:00.000Z' })).toEqual({ changed: 1 });
    expect((await client.school.listNotifications({ schoolId: school.id, filter: 'unread' })).items.map((item) => item.id)).toEqual([ids[1]]);

    // A row created "in the future" (after the server's now) stays unread even with a later `before`.
    await setCreatedAt(ids[1]!, new Date(Date.now() + 60 * 60 * 1000));
    expect(await client.school.markAllNotificationsRead({ schoolId: school.id, before: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() })).toEqual({ changed: 0 });
    await setCreatedAt(ids[1]!, new Date(Date.now() - 1000));
    expect(await client.school.markAllNotificationsRead({ schoolId: school.id })).toEqual({ changed: 1 });
    expect(await client.school.getUnreadNotificationCount({ schoolId: school.id })).toEqual({ count: 0 });
  });

  it('dismisses read rows only, keeping the row for the delivery log', async () => {
    const { school, client, ids } = await staffInbox(2);
    await client.school.markNotificationsRead({ schoolId: school.id, ids: [ids[0]!] });
    expect(await client.school.dismissNotifications({ schoolId: school.id, ids })).toEqual({ changed: 1 });
    expect((await client.school.listNotifications({ schoolId: school.id })).items.map((item) => item.id)).toEqual([ids[1]]);
    const [dismissed] = await db
      .select({ dismissedAt: notificationTable.dismissedAt })
      .from(notificationTable)
      .where(and(eq(notificationTable.id, ids[0]!), eq(notificationTable.schoolId, school.id)));
    expect(dismissed!.dismissedAt).toBeInstanceOf(Date);
  });
});
