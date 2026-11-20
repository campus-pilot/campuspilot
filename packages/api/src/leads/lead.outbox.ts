import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { leadTable } from '@campuspilot/db/schema/lead';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { sendLeadAlertSchedule } from '../workflows/lead-alert/restate';
import { log } from '../workflows/lead-alert/log';

/**
 * The lead alert outbox. A `lead` row with `alert_status = 'pending'` and no
 * `alert_handed_over_at` is work the API owes Restate: the public route
 * commits the lead, schedules its alert in the background
 * ({@link handOffLeadAlert}) and answers at once. The sweep
 * ({@link sweepLeadAlertOutbox}, on the API server's 30 s loop) re-sends
 * every lead Restate has not accepted, indefinitely, showing the last
 * hand-over error on the row.
 *
 * Scheduling only needs Restate: an accepted alert runs whenever a worker is
 * up, so a stopped worker delays alerts but never loses one, and nothing
 * here waits for it.
 */

/** Leads handed over per sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 50;

/** Safe one-line description of a hand-over failure (no URLs or secrets). */
function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

/**
 * Schedules one lead's alert with Restate. Only an alert that is pending and
 * not yet accepted is sent; a second sender (the sweep racing the
 * post-commit hand-off, or another replica) joins the same invocation
 * through the idempotency key, and its writes are conditional.
 */
export async function dispatchLeadAlert(db: DatabaseExecutor, leadId: string): Promise<boolean> {
  const unsent = and(eq(leadTable.id, leadId), eq(leadTable.alertStatus, 'pending'), isNull(leadTable.alertHandedOverAt));
  const [lead] = await db.select({ id: leadTable.id }).from(leadTable).where(unsent).limit(1);
  if (!lead) return false;
  try {
    await sendLeadAlertSchedule(leadId);
    await db
      .update(leadTable)
      .set({ alertHandedOverAt: new Date(), alertHandoverAttempts: sql`${leadTable.alertHandoverAttempts} + 1`, alertLastHandoverError: null })
      .where(unsent);
    return true;
  } catch (error) {
    await db
      .update(leadTable)
      .set({ alertHandoverAttempts: sql`${leadTable.alertHandoverAttempts} + 1`, alertLastHandoverError: describeHandoverError(error) })
      .where(unsent);
    log.warn({ leadId, reason: describeHandoverError(error) }, 'lead-alert.handover.failed');
    return false;
  }
}

/**
 * Schedules a just-committed lead's alert without making the request wait:
 * the promise is not awaited, and any failure is logged and left to the
 * sweep.
 */
export function handOffLeadAlert(leadId: string, db: DatabaseExecutor = defaultDb) {
  void dispatchLeadAlert(db, leadId).catch((error: unknown) => {
    log.error({ leadId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'lead-alert.handoff.error');
  });
}

/** One outbox sweep, safe across API replicas and bounded per run. */
export async function sweepLeadAlertOutbox(db: DatabaseExecutor = defaultDb) {
  const rows = await db
    .select({ id: leadTable.id })
    .from(leadTable)
    .where(and(eq(leadTable.alertStatus, 'pending'), isNull(leadTable.alertHandedOverAt)))
    .orderBy(asc(leadTable.createdAt))
    .limit(SWEEP_LIMIT);
  let handedOver = 0;
  for (const row of rows) if (await dispatchLeadAlert(db, row.id)) handedOver += 1;
  return { unsent: rows.length, handedOver };
}
