import { db } from '@campuspilot/db';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAdmission, createTestSchool, createTestSchoolMember, createTestUser } from '../../test/fixtures';
import { billingRunPostedData, billIssuedData, dispatchNow } from '../../test/notifications';
import type { NotificationChannelAdapter } from './channels';
import { senderLaneFor } from './sender/lanes';
import { notify } from './notify';

vi.mock('./notification.restate', () => ({ sendNotificationDispatch: vi.fn(), sendNotificationSenderPoke: vi.fn() }));
vi.mock('../workflows/restate-admin', () => ({ getRestateInvocation: vi.fn(), cancelRestateInvocation: vi.fn() }));

const { sendNotificationDispatch, sendNotificationSenderPoke } = await import('./notification.restate');
const { getRestateInvocation, cancelRestateInvocation } = await import('../workflows/restate-admin');
const { dispatchNotificationEvent, failStaleEvents, pokeDueSenders, retryFailedEvents, sweepNotificationOutbox } = await import('./notification.outbox');

async function pendingEvent() {
  const school = await createTestSchool();
  const member = await createTestUser();
  await createTestSchoolMember({ schoolId: school.id, userId: member.id, roles: [] });
  const { eventId } = await db.transaction((tx) =>
    notify(tx, { sendPriority: 'immediate', type: 'billing.run_posted', data: billingRunPostedData(), schoolId: school.id, recipients: { kind: 'staff_users', userIds: [member.id] }, key: `outbox:${randomUUID()}` }),
  );
  return eventId;
}

describe('notification outbox', () => {
  beforeEach(() => {
    vi.mocked(sendNotificationDispatch).mockReset();
  });

  it('records an accepted hand-over once', async () => {
    const eventId = await pendingEvent();
    vi.mocked(sendNotificationDispatch).mockResolvedValue({ invocationId: 'inv_control1' });
    expect(await dispatchNotificationEvent(db, eventId)).toBe(true);
    expect(await dispatchNotificationEvent(db, eventId)).toBe(false);
    expect(sendNotificationDispatch).toHaveBeenCalledTimes(1);
    expect(sendNotificationDispatch).toHaveBeenCalledWith(eventId, 1);
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
    expect(event).toMatchObject({ status: 'failed', failureRetryable: true, dispatchAttempt: 1 });
    expect(event!.error).toMatch(/paused/);
  });

  it('retries a retryable failed fan-out as the next attempt after its delay, a bounded number of times', async () => {
    const eventId = await pendingEvent();
    const failAt = async (attempt: number, minutesAgo: number) =>
      db
        .update(notificationEventTable)
        .set({ status: 'failed', failureRetryable: true, dispatchAttempt: attempt, error: 'x', submittedAt: new Date(), updatedAt: new Date(Date.now() - minutesAgo * 60_000) })
        .where(eq(notificationEventTable.id, eventId));
    const read = async () => (await db.select().from(notificationEventTable).where(eq(notificationEventTable.id, eventId)))[0]!;

    // Not before the delay (10 minutes after the first failure).
    await failAt(1, 5);
    await retryFailedEvents(db);
    expect(await read()).toMatchObject({ status: 'failed', dispatchAttempt: 1 });

    await failAt(1, 11);
    vi.mocked(sendNotificationDispatch).mockResolvedValue({ invocationId: 'inv_retry2' });
    await sweepNotificationOutbox(db);
    expect(await read()).toMatchObject({ status: 'pending', dispatchAttempt: 2, failureRetryable: null, error: null, submitInvocationId: 'inv_retry2' });
    // The sweep is platform-wide: other files' pending events may be sent in the same sweep.
    expect(sendNotificationDispatch).toHaveBeenCalledWith(eventId, 2);

    // The last attempt's failure stays failed.
    await failAt(3, 120);
    expect(await retryFailedEvents(db)).toBe(0);
    expect(await read()).toMatchObject({ status: 'failed', dispatchAttempt: 3 });
  });

  it('never retries a deterministic or cancelled failure', async () => {
    const eventId = await pendingEvent();
    await db
      .update(notificationEventTable)
      .set({ status: 'failed', failureRetryable: false, error: 'The notification type is no longer known to this release.', updatedAt: new Date(Date.now() - 120 * 60_000) })
      .where(eq(notificationEventTable.id, eventId));
    await retryFailedEvents(db);
    const [event] = await db.select().from(notificationEventTable).where(eq(notificationEventTable.id, eventId));
    expect(event).toMatchObject({ status: 'failed', dispatchAttempt: 1 });
  });

  it('stops handing over at the first event Restate does not accept', async () => {
    await pendingEvent();
    await pendingEvent();
    vi.mocked(sendNotificationDispatch).mockRejectedValue(new Error('The operation was aborted due to timeout'));
    vi.mocked(getRestateInvocation).mockResolvedValue({ status: 'running', createdAt: Date.now() });
    const result = await sweepNotificationOutbox(db);
    expect(result.pending).toBeGreaterThanOrEqual(2);
    expect(sendNotificationDispatch).toHaveBeenCalledTimes(1);
    vi.mocked(sendNotificationDispatch).mockReset();
  });

  it('checks the least recently checked accepted events first and stops a pass on a Restate admin error', async () => {
    const first = await pendingEvent();
    const second = await pendingEvent();
    await db.update(notificationEventTable).set({ submittedAt: new Date('2019-01-01T00:00:00Z'), submitInvocationId: 'inv_rotate1' }).where(eq(notificationEventTable.id, first));
    await db.update(notificationEventTable).set({ submittedAt: new Date('2020-01-01T00:00:00Z'), submitInvocationId: 'inv_rotate2' }).where(eq(notificationEventTable.id, second));
    vi.mocked(getRestateInvocation).mockReset().mockRejectedValue(new Error('Restate admin query failed (503).'));

    expect(await failStaleEvents(db)).toBe(0);
    expect(getRestateInvocation).toHaveBeenCalledTimes(1);
    expect(getRestateInvocation).toHaveBeenLastCalledWith('inv_rotate1');
    // The checked event rotated to the back: the next pass starts with the other one.
    await failStaleEvents(db);
    expect(getRestateInvocation).toHaveBeenLastCalledWith('inv_rotate2');

    vi.mocked(getRestateInvocation).mockReset();
    await db.update(notificationEventTable).set({ status: 'dispatched' }).where(eq(notificationEventTable.id, first));
    await db.update(notificationEventTable).set({ status: 'dispatched' }).where(eq(notificationEventTable.id, second));
  });

  it('pokes every sender lane with a due delivery, and none for copies scheduled later', async () => {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const { eventId } = await db.transaction((tx) =>
      notify(tx, { sendPriority: 'immediate', type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] }, key: `poke:${randomUUID()}` }),
    );
    const owedOn = (channel: 'web_push' | 'whatsapp'): NotificationChannelAdapter => ({ channel, available: true, decide: () => [{ status: 'owed', destination: `dest-${channel}` }], send: vi.fn() });
    await dispatchNow(eventId, { web_push: owedOn('web_push'), whatsapp: owedOn('whatsapp') });
    const pushLane = senderLaneFor('web_push', school.id);
    vi.mocked(sendNotificationSenderPoke).mockReset();
    vi.mocked(sendNotificationSenderPoke).mockResolvedValue(undefined);
    await pokeDueSenders(db);
    expect(sendNotificationSenderPoke).toHaveBeenCalledWith({ channel: 'whatsapp', lane: 0 }, expect.any(Date));
    expect(sendNotificationSenderPoke).toHaveBeenCalledWith({ channel: 'web_push', lane: pushLane }, expect.any(Date));

    // Rescheduled a day ahead: this school's copies are not due, so they never cause a poke now.
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const notifications = await db.select({ id: notificationTable.id }).from(notificationTable).where(eq(notificationTable.eventId, eventId));
    await db.update(notificationDeliveryTable).set({ nextAttemptAt: later }).where(inArray(notificationDeliveryTable.notificationId, notifications.map((row) => row.id)));
    const dueBefore = await db
      .select({ id: notificationDeliveryTable.id })
      .from(notificationDeliveryTable)
      .where(and(inArray(notificationDeliveryTable.notificationId, notifications.map((row) => row.id)), lte(notificationDeliveryTable.nextAttemptAt, new Date())));
    expect(dueBefore).toEqual([]);
  });

  it('stops poking at the first poke Restate does not accept', async () => {
    vi.mocked(sendNotificationSenderPoke).mockReset();
    vi.mocked(sendNotificationSenderPoke).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const { eventId } = await db.transaction((tx) =>
      notify(tx, { sendPriority: 'immediate', type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] }, key: `poke:${randomUUID()}` }),
    );
    const owedOn = (channel: 'web_push' | 'whatsapp'): NotificationChannelAdapter => ({ channel, available: true, decide: () => [{ status: 'owed', destination: `dest-${channel}` }], send: vi.fn() });
    await dispatchNow(eventId, { web_push: owedOn('web_push'), whatsapp: owedOn('whatsapp') });
    expect(await pokeDueSenders(db)).toBe(0);
    expect(sendNotificationSenderPoke).toHaveBeenCalledTimes(1);
  });
});
