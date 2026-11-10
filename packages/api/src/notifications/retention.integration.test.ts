import { db } from '@campuspilot/db';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestAdmission, createTestSchool } from '../../test/fixtures';
import { billIssuedData, emitAndDispatch } from '../../test/notifications';
import { notificationRowId } from './ids';
import { sweepNotificationRetention } from './retention';

const DAY = 24 * 60 * 60 * 1000;

async function studentRow(ageDays: number, read: boolean) {
  const school = await createTestSchool();
  const admission = await createTestAdmission({ schoolId: school.id });
  const { eventId } = await emitAndDispatch({ type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] } });
  const id = notificationRowId(eventId, { kind: 'admission', id: admission.id });
  const createdAt = new Date(Date.now() - ageDays * DAY);
  await db.update(notificationTable).set({ createdAt, readAt: read ? createdAt : null }).where(eq(notificationTable.id, id));
  await db.update(notificationEventTable).set({ createdAt }).where(eq(notificationEventTable.id, eventId));
  return { id, eventId };
}

describe('notification retention', () => {
  it('deletes read rows after 90 days and unread rows after 180, with their deliveries', async () => {
    const readOld = await studentRow(91, true);
    const readRecent = await studentRow(89, true);
    const unreadMiddle = await studentRow(120, false);
    const unreadOld = await studentRow(181, false);

    await sweepNotificationRetention(db);

    const remaining = await db
      .select({ id: notificationTable.id })
      .from(notificationTable)
      .where(inArray(notificationTable.id, [readOld.id, readRecent.id, unreadMiddle.id, unreadOld.id]));
    expect(remaining.map((row) => row.id).sort()).toEqual([readRecent.id, unreadMiddle.id].sort());
    expect(await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.notificationId, [readOld.id, unreadOld.id]))).toEqual([]);
    // The 181-day event finished long ago and goes too; the 120-day one stays.
    const events = await db
      .select({ id: notificationEventTable.id })
      .from(notificationEventTable)
      .where(inArray(notificationEventTable.id, [unreadMiddle.eventId, unreadOld.eventId]));
    expect(events.map((event) => event.id)).toEqual([unreadMiddle.eventId]);
  });
});
