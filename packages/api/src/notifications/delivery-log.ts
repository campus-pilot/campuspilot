import type { DatabaseExecutor } from '@campuspilot/db';
import { notificationTypesFor } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, count, desc, eq, exists, inArray, isNotNull, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../paginations';
import { activePushDestinations, isPushSubscriptionGone } from './redelivery';
import { stuckSendingCutoff } from './stuck-sending';

/**
 * The staff delivery log (Phase 7, permission `school.notification.log.read`):
 * student notifications of one scope with every channel copy's status and
 * skip or failure reason. It shows which notification it was (type, the
 * student's name and a human reference such as the bill or receipt number
 * the exam name or the notice title) but never amounts or message text: log readers include
 * roles without finance access. Students never see delivery rows (D-20).
 */

/** Which notifications a log lists; exactly one scope per request. */
export type DeliveryLogScope =
  | { kind: 'admission'; admissionId: string }
  | { kind: 'bill_run'; billRunId: string }
  | { kind: 'exam'; sessionId: string; examSlug: string }
  | { kind: 'notice'; noticeId: string };


/**
 * The scope as a predicate over a row carrying a catalogue `type` and its
 * `data` facts. Inbox rows copy both from their event unchanged, so the same
 * predicate selects a scope's notifications and the events that produce them.
 * `admissionId` is the row's addressed admission: a column on an inbox row,
 * the `admissionId` fact every student type carries on an event.
 */
type ScopedRow = { type: AnyColumn; data: AnyColumn; admissionId: AnyColumn | SQL };
const EVENT_ROW: ScopedRow = {
  type: notificationEventTable.type,
  data: notificationEventTable.data,
  admissionId: sql`${notificationEventTable.data}->>'admissionId'`,
};

function scopeWhere(scope: DeliveryLogScope, row: ScopedRow): SQL {
  switch (scope.kind) {
    case 'admission':
      return sql`${row.admissionId} = ${scope.admissionId}`;
    case 'bill_run':
      return and(eq(row.type, 'bill.issued'), sql`${row.data}->>'billRunId' = ${scope.billRunId}`)!;
    case 'exam':
      return and(
        eq(row.type, 'exam.results_published'),
        sql`${row.data}->>'sessionId' = ${scope.sessionId}`,
        sql`${row.data}->>'examSlug' = ${scope.examSlug}`,
      )!;
    case 'notice':
      return and(eq(row.type, 'notice.published'), sql`${row.data}->>'noticeId' = ${scope.noticeId}`)!;
    default: {
      const unhandled: never = scope;
      throw new Error(`Unhandled delivery log scope ${JSON.stringify(unhandled)}.`);
    }
  }
}

/**
 * How far the scope's fan-out is. Emitting writes one outbox event per
 * student in the business transaction; the worker turns each into its inbox
 * and delivery rows afterwards, one event at a time. Until then a
 * notification is not in the log at all, so a log read right after a bulk
 * action (publishing a notice, posting a run, releasing results) lists only
 * the students dispatched so far. These counts say so explicitly:
 * - `pendingCount`: events not fanned out yet (their rows will appear);
 * - `failedCount`: events the worker gave up on (their rows may be missing
 *   or partial; the outbox retries the retryable ones as pending again).
 * Staff resends are events too but add a copy to an existing notification;
 * they are not counted.
 */
async function scopePreparation(db: DatabaseExecutor, schoolId: string, scope: DeliveryLogScope) {
  const rows = await db
    .select({ status: notificationEventTable.status, value: count() })
    .from(notificationEventTable)
    .where(
      and(
        eq(notificationEventTable.schoolId, schoolId),
        inArray(notificationEventTable.type, notificationTypesFor('admission')),
        inArray(notificationEventTable.status, ['pending', 'failed']),
        isNull(notificationEventTable.redeliveryOfDeliveryId),
        scopeWhere(scope, EVENT_ROW),
      ),
    )
    .groupBy(notificationEventTable.status);
  const of = (status: 'pending' | 'failed') => rows.find((row) => row.status === status)?.value ?? 0;
  return { pendingCount: of('pending'), failedCount: of('failed') };
}

/** The human reference of a notification (never an amount). */
function referenceOf(type: string, data: Record<string, unknown>): string | null {
  const value =
    type === 'bill.issued'
      ? data.billNumber
      : type === 'payment.received'
        ? data.receiptNumber
        : type === 'exam.results_published'
          ? data.examName
          : type === 'notice.published'
            ? data.noticeTitle
            : null;
  return typeof value === 'string' ? value : null;
}

/**
 * One page of a scope's student notifications, newest first, each with all
 * of its deliveries (oldest first, resends after the copy they resend).
 * `onlyFailed` keeps notifications with at least one failed delivery.
 * Retired types are left out. `preparation` reports the part of the scope
 * that is not in the list yet (see {@link scopePreparation}); it describes
 * the whole scope, independent of the page and of `onlyFailed`.
 */
export async function listDeliveryLog(
  db: DatabaseExecutor,
  input: { schoolId: string; scope: DeliveryLogScope; onlyFailed: boolean; page?: number; cursor?: string; limit: number },
) {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const failedDelivery = db
    .select({ one: sql`1` })
    .from(notificationDeliveryTable)
    .where(and(eq(notificationDeliveryTable.notificationId, notificationTable.id), eq(notificationDeliveryTable.status, 'failed')));
  const where = and(
    eq(notificationTable.schoolId, input.schoolId),
    eq(notificationTable.recipientKind, 'admission'),
    isNotNull(notificationTable.admissionId),
    inArray(notificationTable.type, notificationTypesFor('admission')),
    scopeWhere(input.scope, notificationTable),
    input.onlyFailed ? exists(failedDelivery) : undefined,
  );
  const [total] = await db.select({ value: count() }).from(notificationTable).where(where);
  const rows = await db
    .select({
      id: notificationTable.id,
      type: notificationTable.type,
      data: notificationTable.data,
      admissionId: notificationTable.admissionId,
      createdAt: notificationTable.createdAt,
    })
    .from(notificationTable)
    .where(where)
    .orderBy(desc(notificationTable.createdAt), desc(notificationTable.id))
    .limit(pageSize)
    .offset(offset);
  const deliveries = rows.length
    ? await db
        .select()
        .from(notificationDeliveryTable)
        .where(and(eq(notificationDeliveryTable.schoolId, input.schoolId), inArray(notificationDeliveryTable.notificationId, rows.map((row) => row.id))))
        .orderBy(notificationDeliveryTable.createdAt, notificationDeliveryTable.id)
    : [];
  const resent = new Set(deliveries.flatMap((delivery) => (delivery.resendOfDeliveryId ? [delivery.resendOfDeliveryId] : [])));
  const failedPush = deliveries.filter((delivery) => delivery.channel === 'web_push' && delivery.status === 'failed');
  const activePush = await activePushDestinations(db, failedPush.flatMap((delivery) => (delivery.destination ? [delivery.destination] : [])));
  const now = new Date();
  const totalItems = total?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  const preparation = await scopePreparation(db, input.schoolId, input.scope);
  const page = createPaginatedResult({
    items: rows.map((row) => ({
      notificationId: row.id,
      type: row.type,
      admissionId: row.admissionId!,
      studentName: typeof row.data.studentName === 'string' ? row.data.studentName : null,
      reference: referenceOf(row.type, row.data),
      createdAt: row.createdAt,
      deliveries: deliveries
        .filter((delivery) => delivery.notificationId === row.id)
        .map((delivery) => ({
          id: delivery.id,
          channel: delivery.channel,
          status: delivery.status,
          skipReason: delivery.skipReason,
          errorCode: delivery.errorCode,
          errorMessage: delivery.errorMessage,
          attempts: delivery.attempts,
          createdAt: delivery.createdAt,
          sentAt: delivery.sentAt,
          deliveredAt: delivery.deliveredAt,
          readAt: delivery.readAt,
          failedAt: delivery.failedAt,
          /**
           * A `sending` claim older than `STUCK_SENDING_MS`: the send was
           * interrupted and may or may not have gone out. Shown only until
           * the outbox sweep fails it as `outcome_unknown` (then resendable).
           */
          interrupted: delivery.status === 'sending' && (delivery.claimedAt?.getTime() ?? now.getTime()) < stuckSendingCutoff(now).getTime(),
          resendOfDeliveryId: delivery.resendOfDeliveryId,
          /** A staff resend of this delivery exists (each failed delivery can be resent once). */
          resent: resent.has(delivery.id),
          /** A failed web push copy whose device no longer receives notifications (D-40). */
          subscriptionGone: delivery.status === 'failed' && isPushSubscriptionGone(delivery, activePush),
          /**
           * Staff may resend it: failed, not resent yet, and (web push) its
           * device still subscribed. A copy still `sending` is not
           * resendable; once the sweep fails an interrupted one as
           * `outcome_unknown` it is, like any ambiguous send.
           */
          resendable: delivery.status === 'failed' && !resent.has(delivery.id) && !isPushSubscriptionGone(delivery, activePush),
          /** When an owed copy is due to be (re)tried; null otherwise. */
          nextAttemptAt: delivery.status === 'owed' ? delivery.nextAttemptAt : null,
        })),
    })),
    nextCursor: createNextPageCursor(currentPage, totalPages),
    currentPage,
    totalPages,
    totalItems,
    pageSize,
  });
  return { ...page, preparation };
}
