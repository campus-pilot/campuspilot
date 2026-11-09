import { db } from '@campuspilot/db';
import { notificationEventTable } from '@campuspilot/db/schema/notification';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSchool, createTestSchoolMember, createTestUser } from '../../test/fixtures';
import { billingRunPostedData } from '../../test/notifications';
import { notify } from './notify';

vi.mock('./notification.restate', () => ({ sendNotificationDispatch: vi.fn() }));
vi.mock('../workflows/restate-admin', () => ({ getRestateInvocation: vi.fn(), cancelRestateInvocation: vi.fn() }));

const { sendNotificationDispatch } = await import('./notification.restate');
const { getRestateInvocation, cancelRestateInvocation } = await import('../workflows/restate-admin');
const { dispatchNotificationEvent, sweepNotificationOutbox } = await import('./notification.outbox');

async function pendingEvent() {
  const school = await createTestSchool();
  const member = await createTestUser();
  await createTestSchoolMember({ schoolId: school.id, userId: member.id, roles: [] });
  const { eventId } = await db.transaction((tx) =>
    notify(tx, { type: 'billing.run_posted', data: billingRunPostedData(), schoolId: school.id, recipients: { kind: 'staff_users', userIds: [member.id] }, key: `outbox:${randomUUID()}` }),
  );
  return eventId;
}

describe('notification outbox', () => {
  beforeEach(() => vi.mocked(sendNotificationDispatch).mockReset());

  it('records an accepted hand-over once', async () => {
    const eventId = await pendingEvent();
    vi.mocked(sendNotificationDispatch).mockResolvedValue({ invocationId: 'inv_control1' });
    expect(await dispatchNotificationEvent(db, eventId)).toBe(true);
    expect(await dispatchNotificationEvent(db, eventId)).toBe(false);
    expect(sendNotificationDispatch).toHaveBeenCalledTimes(1);
    const [event] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.id, eventId));
    expect(event).toMatchObject({ status: 'pending', submitInvocationId: 'inv_control1', submitAttempts: 1, lastSubmitError: null });
  });

  it('keeps an event pending with a safe error while Restate is unreachable, then the sweep re-sends it', async () => {
    const eventId = await pendingEvent();
    vi.mocked(sendNotificationDispatch).mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:8080'));
    expect(await dispatchNotificationEvent(db, eventId)).toBe(false);
    const [failed] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.id, eventId));
    expect(failed).toMatchObject({ submittedAt: null, submitAttempts: 1, lastSubmitError: 'Restate is unreachable.' });

    vi.mocked(sendNotificationDispatch).mockResolvedValue({ invocationId: 'inv_control2' });
    vi.mocked(getRestateInvocation).mockResolvedValue({ status: 'running', createdAt: Date.now() });
    await sweepNotificationOutbox(db);
    const [sent] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.id, eventId));
    expect(sent).toMatchObject({ submitInvocationId: 'inv_control2', submitAttempts: 2, lastSubmitError: null });
  });

  it('fails an accepted event whose dispatch Restate paused', async () => {
    const eventId = await pendingEvent();
    await db
      .update(notificationEventTable)
      .set({ submittedAt: new Date(Date.now() - 10 * 60_000), submitInvocationId: 'inv_control3', invocationId: 'inv_workflow3' })
      .where(eq(notificationEventTable.id, eventId));
    vi.mocked(sendNotificationDispatch).mockResolvedValue({ invocationId: 'inv_unused' });
    vi.mocked(getRestateInvocation).mockImplementation(async (id) => ({ status: id === 'inv_workflow3' ? 'paused' : 'running', createdAt: Date.now() }));
    await sweepNotificationOutbox(db);
    expect(cancelRestateInvocation).toHaveBeenCalledWith('inv_workflow3');
    const [event] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.id, eventId));
    expect(event).toMatchObject({ status: 'failed' });
    expect(event!.error).toMatch(/paused/);
  });
});
