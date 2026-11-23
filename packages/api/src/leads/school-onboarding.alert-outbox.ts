import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { log } from '../workflows/lead-alert/log';
import { sendOnboardingAlertSchedule } from '../workflows/lead-alert/restate';

/**
 * The outbox of School Onboarding alerts, as for leads (`lead.outbox.ts`): a
 * request with `alert_status = 'pending'` and no `alert_handed_over_at` is an
 * alert the API owes Restate. The submission schedules it after commit
 * without waiting ({@link handOffOnboardingAlert}); the sweep re-sends every
 * one Restate has not accepted, showing the last hand-over error on the row.
 */

const SWEEP_LIMIT = 50;
const table = schoolRegistrationRequestTable;

function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

export async function dispatchOnboardingAlert(db: DatabaseExecutor, requestId: string): Promise<boolean> {
  const unsent = and(eq(table.id, requestId), eq(table.alertStatus, 'pending'), isNull(table.alertHandedOverAt));
  const [request] = await db.select({ id: table.id }).from(table).where(unsent).limit(1);
  if (!request) return false;
  try {
    await sendOnboardingAlertSchedule(requestId);
    await db
      .update(table)
      .set({ alertHandedOverAt: new Date(), alertHandoverAttempts: sql`${table.alertHandoverAttempts} + 1`, alertLastHandoverError: null })
      .where(unsent);
    return true;
  } catch (error) {
    await db
      .update(table)
      .set({ alertHandoverAttempts: sql`${table.alertHandoverAttempts} + 1`, alertLastHandoverError: describeHandoverError(error) })
      .where(unsent);
    log.warn({ requestId, reason: describeHandoverError(error) }, 'school-onboarding-alert.handover.failed');
    return false;
  }
}

/** Schedules a just-committed submission's alert without making the request wait. */
export function handOffOnboardingAlert(requestId: string, db: DatabaseExecutor = defaultDb) {
  void dispatchOnboardingAlert(db, requestId).catch((error: unknown) => {
    log.error({ requestId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'school-onboarding-alert.handoff.error');
  });
}

/** One sweep, safe across API replicas and bounded per run. */
export async function sweepOnboardingAlertOutbox(db: DatabaseExecutor = defaultDb) {
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.alertStatus, 'pending'), isNull(table.alertHandedOverAt)))
    .orderBy(asc(table.createdAt))
    .limit(SWEEP_LIMIT);
  let handedOver = 0;
  for (const row of rows) if (await dispatchOnboardingAlert(db, row.id)) handedOver += 1;
  return { unsent: rows.length, handedOver };
}
