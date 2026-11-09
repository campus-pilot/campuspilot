import type { DatabaseExecutor } from '@campuspilot/db';
import { notificationTypesFor } from '@campuspilot/db/notifications/catalogue';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, count, desc, eq, exists, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';

import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../paginations';
import { activePushDestinations, isPushSubscriptionGone } from './redelivery';

/**
 * The staff delivery log (Phase 7, permission `school.notification.log.read`):
 * student notifications of one scope with every channel copy's status and
 * skip or failure reason. It shows which notification it was (type, the
 * student's name and a human reference such as the bill or receipt number
 * or the exam name) but never amounts or message text: log readers include
 * roles without finance access. Students never see delivery rows (D-20).
 */

/** Which notifications a log lists; exactly one scope per request. */
export type DeliveryLogScope =
  | { kind: 'admission'; admissionId: string }
  | { kind: 'bill_run'; billRunId: string }
  | { kind: 'exam'; sessionId: string; examSlug: string };

/** A delivery claimed this long ago without an outcome is shown as interrupted. */
export const INTERRUPTED_SENDING_MS = 60 * 60 * 1000;

function scopeWhere(scope: DeliveryLogScope): SQL {
  switch (scope.kind) {
    case 'admission':
      return eq(notificationTable.admissionId, scope.admissionId);
    case 'bill_run':
      return and(eq(notificationTable.type, 'bill.issued'), sql`${notificationTable.data}->>'billRunId' = ${scope.billRunId}`)!;
    case 'exam':
      return and(
        eq(notificationTable.type, 'exam.results_published'),
        sql`${notificationTable.data}->>'sessionId' = ${scope.sessionId}`,
        sql`${notificationTable.data}->>'examSlug' = ${scope.examSlug}`,
      )!;
    default: {
      const unhandled: never = scope;
      throw new Error(`Unhandled delivery log scope ${JSON.stringify(unhandled)}.`);
    }
  }
}

/** The human reference of a notification (never an amount). */
function referenceOf(type: string, data: Record<string, unknown>): string | null {
  const value = type === 'bill.issued' ? data.billNumber : type === 'payment.received' ? data.receiptNumber : type === 'exam.results_published' ? data.examName : null;
  return typeof value === 'string' ? value : null;
}

/**
 * One page of a scope's student notifications, newest first, each with all
 * of its deliveries (oldest first, resends after the copy they resend).
 * `onlyFailed` keeps notifications with at least one failed delivery.
 * Retired types are left out.
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
    scopeWhere(input.scope),
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
  const now = Date.now();
  const totalItems = total?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({
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
          /** A `sending` claim older than an hour: the worker died mid-send; it may or may not have been sent. */
          interrupted: delivery.status === 'sending' && (delivery.claimedAt?.getTime() ?? now) < now - INTERRUPTED_SENDING_MS,
          resendOfDeliveryId: delivery.resendOfDeliveryId,
          /** A staff resend of this delivery exists (each failed delivery can be resent once). */
          resent: resent.has(delivery.id),
          /** A failed web push copy whose device no longer receives notifications (D-40). */
          subscriptionGone: delivery.status === 'failed' && isPushSubscriptionGone(delivery, activePush),
          /**
           * Staff may resend it: failed, not resent yet, and (web push) its
           * device still subscribed. Stuck `sending` copies are never
           * resendable (they may have been sent, D-25).
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
}
