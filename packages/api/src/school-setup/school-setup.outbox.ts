import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { schoolSetupTable } from '@campuspilot/db/schema/school-setup';
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';

import { cancelRestateInvocation, getRestateInvocation, type RestateInvocationStatus } from '../workflows/restate-admin';
import { log } from '../workflows/school-setup/log';
import { sendSchoolSetupStart } from '../workflows/school-setup/restate';

/**
 * The school setup outbox, as for demo schools (docs/demo-school.md, "The
 * outbox"): a `queued` setup with `start_requested_at` and no `submitted_at`
 * is a start the API owes Restate. `startSchoolSetup` writes it, hands it over
 * in the background ({@link handOffSchoolSetup}) and returns at once; the
 * sweep ({@link sweepSchoolSetupOutbox}, on the API's 30 s loop) re-sends it
 * and turns a setup that can no longer progress into a visible failure: a
 * start Restate did not accept within 10 minutes, or an accepted run Restate
 * paused or that ended without finishing.
 */

const SWEEP_LIMIT = 20;
export const SCHOOL_SETUP_HANDOVER_DEADLINE_MS = 10 * 60 * 1000;
const STALE_CHECK_AFTER_MS = 60 * 1000;

const MESSAGES = {
  handoverFailed: 'The workflow engine could not be reached for 10 minutes. Retry when it is back.',
  paused: 'The workflow engine paused this run after repeated failures (is the worker running?). Retry it.',
  ended: 'The run ended without finishing. Retry it.',
} as const;

function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

/** Sends the current attempt of a requested start; every write is fenced by attempt. */
export async function dispatchSchoolSetupStart(db: DatabaseExecutor, setupId: string): Promise<boolean> {
  const [setup] = await db
    .select({ attempt: schoolSetupTable.attempt })
    .from(schoolSetupTable)
    .where(and(eq(schoolSetupTable.id, setupId), eq(schoolSetupTable.status, 'queued'), isNotNull(schoolSetupTable.startRequestedAt), isNull(schoolSetupTable.submittedAt)))
    .limit(1);
  if (!setup) return false;
  const fence = and(eq(schoolSetupTable.id, setupId), eq(schoolSetupTable.attempt, setup.attempt), isNull(schoolSetupTable.submittedAt));
  try {
    const { invocationId } = await sendSchoolSetupStart(setupId, setup.attempt);
    await db
      .update(schoolSetupTable)
      .set({ submittedAt: new Date(), submitInvocationId: invocationId, submitAttempts: sql`${schoolSetupTable.submitAttempts} + 1`, lastSubmitError: null })
      .where(fence);
    return true;
  } catch (error) {
    await db
      .update(schoolSetupTable)
      .set({ submitAttempts: sql`${schoolSetupTable.submitAttempts} + 1`, lastSubmitError: describeHandoverError(error) })
      .where(fence);
    log.warn({ setupId, attempt: setup.attempt, reason: describeHandoverError(error) }, 'school-setup.handover.failed');
    return false;
  }
}

/** Hands a just-committed start over without making the request wait; failures are left to the sweep. */
export function handOffSchoolSetup(setupId: string, db: DatabaseExecutor = defaultDb) {
  void dispatchSchoolSetupStart(db, setupId).catch((error: unknown) => {
    log.error({ setupId, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'school-setup.handoff.error');
  });
}

function staleVerdict(status: RestateInvocationStatus | null): 'paused' | 'ended' | null {
  if (status === 'paused') return 'paused';
  if (status === null || status === 'completed') return 'ended';
  return null;
}

/** One sweep: re-send unaccepted starts, fail overdue hand-overs and stalled runs. Safe across replicas. */
export async function sweepSchoolSetupOutbox(db: DatabaseExecutor = defaultDb) {
  const now = Date.now();
  const unsent = await db
    .select({ id: schoolSetupTable.id, attempt: schoolSetupTable.attempt, startRequestedAt: schoolSetupTable.startRequestedAt })
    .from(schoolSetupTable)
    .where(and(eq(schoolSetupTable.status, 'queued'), isNotNull(schoolSetupTable.startRequestedAt), isNull(schoolSetupTable.submittedAt)))
    .orderBy(asc(schoolSetupTable.startRequestedAt))
    .limit(SWEEP_LIMIT);
  let handedOver = 0;
  let failed = 0;
  for (const setup of unsent) {
    if (await dispatchSchoolSetupStart(db, setup.id)) {
      handedOver += 1;
    } else if (setup.startRequestedAt && now - setup.startRequestedAt.getTime() > SCHOOL_SETUP_HANDOVER_DEADLINE_MS) {
      const [row] = await db
        .update(schoolSetupTable)
        .set({ status: 'failed', error: { step: 'start', message: MESSAGES.handoverFailed }, finishedAt: new Date() })
        .where(and(eq(schoolSetupTable.id, setup.id), eq(schoolSetupTable.attempt, setup.attempt), eq(schoolSetupTable.status, 'queued'), isNull(schoolSetupTable.submittedAt)))
        .returning({ id: schoolSetupTable.id });
      if (row) failed += 1;
    }
  }
  const accepted = await db
    .select({
      id: schoolSetupTable.id,
      attempt: schoolSetupTable.attempt,
      currentStep: schoolSetupTable.currentStep,
      invocationId: schoolSetupTable.invocationId,
      submitInvocationId: schoolSetupTable.submitInvocationId,
    })
    .from(schoolSetupTable)
    .where(and(inArray(schoolSetupTable.status, ['queued', 'running']), lt(schoolSetupTable.submittedAt, new Date(now - STALE_CHECK_AFTER_MS))))
    .orderBy(asc(schoolSetupTable.submittedAt))
    .limit(SWEEP_LIMIT);
  for (const setup of accepted) {
    const checked = setup.invocationId ?? setup.submitInvocationId;
    if (!checked) continue;
    const verdict = staleVerdict((await getRestateInvocation(checked))?.status ?? null);
    if (!verdict) continue;
    if (verdict === 'paused') await cancelRestateInvocation(checked);
    // Fenced by the invocation checked: a run recorded meanwhile changes nothing.
    const sameInvocation: SQL | undefined = setup.invocationId ? eq(schoolSetupTable.invocationId, setup.invocationId) : isNull(schoolSetupTable.invocationId);
    const [row] = await db
      .update(schoolSetupTable)
      .set({ status: 'failed', error: { step: setup.currentStep ?? 'start', message: MESSAGES[verdict] }, finishedAt: new Date() })
      .where(and(eq(schoolSetupTable.id, setup.id), eq(schoolSetupTable.attempt, setup.attempt), inArray(schoolSetupTable.status, ['queued', 'running']), sameInvocation))
      .returning({ id: schoolSetupTable.id });
    if (row) failed += 1;
  }
  return { unsent: unsent.length, handedOver, failed };
}
