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
vi.mock('../workflows/restate-admin', () => ({
  getRestateInvocation: vi.fn(),
  cancelRestateInvocation: vi.fn(),
  killRestateInvocation: vi.fn(),
  listLiveRestateInvocations: vi.fn(async () => []),
}));

const { sendNotificationDispatch, sendNotificationSenderPoke } = await import('./notification.restate');
const { getRestateInvocation, cancelRestateInvocation, killRestateInvocation, listLiveRestateInvocations } = await import('../workflows/restate-admin');
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

  it('stops handing over once Restate does not accept a hand-over (only those already in flight finish)', async () => {
    for (let index = 0; index < 8; index += 1) await pendingEvent();
    vi.mocked(sendNotificationDispatch).mockRejectedValue(new Error('The operation was aborted due to timeout'));
    vi.mocked(getRestateInvocation).mockResolvedValue({ status: 'running', createdAt: Date.now() });
    const result = await sweepNotificationOutbox(db);
    expect(result.pending).toBeGreaterThanOrEqual(8);
    // At most the four concurrent hand-overs were started.
    expect(vi.mocked(sendNotificationDispatch).mock.calls.length).toBeLessThanOrEqual(4);
    vi.mocked(sendNotificationDispatch).mockReset();
  });

  it('hands over more than one round of pending events in one sweep', async () => {
    const ids = await Promise.all(Array.from({ length: 230 }, () => pendingEvent()));
    let counter = 0;
    vi.mocked(sendNotificationDispatch).mockImplementation(async () => ({ invocationId: `inv_round${(counter += 1)}` }));
    vi.mocked(getRestateInvocation).mockResolvedValue({ status: 'running', createdAt: Date.now() });
    await sweepNotificationOutbox(db);
    const events = await db.select({ submittedAt: notificationEventTable.submittedAt }).from(notificationEventTable).where(inArray(notificationEventTable.id, ids));
    expect(events.every((event) => event.submittedAt !== null)).toBe(true);
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
    vi.mocked(listLiveRestateInvocations).mockResolvedValueOnce([]);
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
    expect(await pokeDueSenders(db)).toMatchObject({ poked: 0 });
    expect(sendNotificationSenderPoke).toHaveBeenCalledTimes(1);
  });

  /** A school with a WhatsApp copy and a web push copy due now; returns the push lane's key. */
  async function dueOnBothChannels() {
    const school = await createTestSchool();
    const admission = await createTestAdmission({ schoolId: school.id });
    const { eventId } = await db.transaction((tx) =>
      notify(tx, { sendPriority: 'immediate', type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] }, key: `poke:${randomUUID()}` }),
    );
    const owedOn = (channel: 'web_push' | 'whatsapp'): NotificationChannelAdapter => ({ channel, available: true, decide: () => [{ status: 'owed', destination: `dest-${channel}` }], send: vi.fn() });
    await dispatchNow(eventId, { web_push: owedOn('web_push'), whatsapp: owedOn('whatsapp') });
    return { pushLane: senderLaneFor('web_push', school.id) };
  }

  it('does not poke a lane whose drain is still live, so pokes never pile up in its inbox', async () => {
    const { pushLane } = await dueOnBothChannels();
    vi.mocked(sendNotificationSenderPoke).mockReset().mockResolvedValue(undefined);
    vi.mocked(listLiveRestateInvocations).mockResolvedValueOnce([
      { id: 'inv_drainrunning', key: 'whatsapp', status: 'running' },
      { id: 'inv_draininboxed', key: `web_push:${pushLane}`, status: 'pending' },
    ]);
    const result = await pokeDueSenders(db);
    expect(listLiveRestateInvocations).toHaveBeenLastCalledWith('NotificationSender');
    expect(sendNotificationSenderPoke).not.toHaveBeenCalledWith({ channel: 'whatsapp', lane: 0 }, expect.any(Date));
    expect(sendNotificationSenderPoke).not.toHaveBeenCalledWith({ channel: 'web_push', lane: pushLane }, expect.any(Date));
    expect(result).toMatchObject({ busy: expect.any(Number), killed: 0 });
    expect(result.busy).toBeGreaterThanOrEqual(2);
  });

  it('kills a paused drain that blocks its lane, then pokes the lane afresh', async () => {
    await dueOnBothChannels();
    vi.mocked(sendNotificationSenderPoke).mockReset().mockResolvedValue(undefined);
    vi.mocked(killRestateInvocation).mockReset().mockResolvedValue(undefined);
    vi.mocked(listLiveRestateInvocations).mockResolvedValueOnce([{ id: 'inv_drainpaused', key: 'whatsapp', status: 'paused' }]);
    expect(await pokeDueSenders(db)).toMatchObject({ killed: 1 });
    expect(killRestateInvocation).toHaveBeenCalledWith('inv_drainpaused');
    expect(sendNotificationSenderPoke).toHaveBeenCalledWith({ channel: 'whatsapp', lane: 0 }, expect.any(Date));

    // A paused drain that cannot be killed keeps its lane blocked: no poke joins the queue behind it.
    vi.mocked(sendNotificationSenderPoke).mockClear();
    vi.mocked(killRestateInvocation).mockRejectedValueOnce(new Error('Restate refused to kill invocation (503).'));
    vi.mocked(listLiveRestateInvocations).mockResolvedValueOnce([{ id: 'inv_drainpaused', key: 'whatsapp', status: 'paused' }]);
    expect(await pokeDueSenders(db)).toMatchObject({ killed: 0 });
    expect(sendNotificationSenderPoke).not.toHaveBeenCalledWith({ channel: 'whatsapp', lane: 0 }, expect.any(Date));
  });

  it('pokes every due lane when the Restate admin API does not answer', async () => {
    const { pushLane } = await dueOnBothChannels();
    vi.mocked(sendNotificationSenderPoke).mockReset().mockResolvedValue(undefined);
    vi.mocked(listLiveRestateInvocations).mockRejectedValueOnce(new Error('Restate admin query failed (503).'));
    await pokeDueSenders(db);
    expect(sendNotificationSenderPoke).toHaveBeenCalledWith({ channel: 'whatsapp', lane: 0 }, expect.any(Date));
    expect(sendNotificationSenderPoke).toHaveBeenCalledWith({ channel: 'web_push', lane: pushLane }, expect.any(Date));
  });
});
