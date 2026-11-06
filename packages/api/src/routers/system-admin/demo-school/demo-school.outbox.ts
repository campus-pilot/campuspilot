import { db as defaultDb, type DatabaseExecutor } from "@campuspilot/db";
import { demoSchoolJobTable, demoSchoolPurgeTable } from "@campuspilot/db/schema/demo-school-job";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";

import { log } from "../../../workflows/demo-school/log";
import {
  cancelRestateInvocation,
  getRestateInvocation,
  type RestateInvocationStatus,
} from "../../../workflows/demo-school/restate-admin";
import { sendDemoSchoolPurge, sendDemoSchoolStart } from "./demo-school.restate";

/**
 * The demo outbox: `demo_school_job` (requested starts) and
 * `demo_school_purge` (requested purges) are the durable record of work the
 * API owes Restate. Kick-off procedures write the row, hand it over in the
 * background ({@link handOff}) and return at once; the sweep
 * ({@link sweepDemoSchoolOutbox}) re-sends whatever Restate has not accepted
 * and turns work that can no longer progress into a visible failure:
 * - a start Restate did not accept within {@link START_HANDOVER_DEADLINE_MS}
 *   (a purge instead keeps retrying, showing its hand-over error);
 * - an accepted run that Restate paused (its retry policy pauses an
 *   invocation after ~70 failed attempts, e.g. a worker down for an hour);
 * - an accepted run that ended without finishing its job or purge.
 * Nothing stays queued or running without either progressing or failing.
 */

/** Rows handled per kind and sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 20;
/** A failed purge is retried automatically this many attempts in total, then waits for an admin. */
export const MAX_AUTOMATIC_PURGE_ATTEMPTS = 5;
/** A start Restate has not accepted after this long fails visibly. */
export const START_HANDOVER_DEADLINE_MS = 10 * 60 * 1000;
/** Accepted work is checked against Restate only after this long, to let it start. */
const STALE_CHECK_AFTER_MS = 60 * 1000;

const MESSAGES = {
  handoverFailed: "The workflow engine could not be reached for 10 minutes. Retry when it is back.",
  paused: "The workflow engine paused this run after repeated failures (is the demo worker running?). Retry it.",
  ended: "The run ended without finishing. Retry it.",
} as const;

/** Safe one-line description of a hand-over failure (no URLs or secrets). */
function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "Restate did not answer in time.";
  if (error instanceof Error && /DEMO_CONTROL_SECRET/.test(error.message)) return error.message;
  return "Restate is unreachable.";
}

/**
 * Starts background work after the response is decided. The promise is not
 * awaited by the request; failures are logged and left to the sweep.
 */
export function handOff(name: string, work: () => Promise<unknown>) {
  void work().catch((error: unknown) => {
    log.error({ err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, `demo-school.${name}.error`);
  });
}

/**
 * Sends the current attempt of a requested start to Restate. Only a job that
 * is still queued, requested and not yet accepted is sent; every write is
 * fenced by attempt, so a send racing a retry or purge changes nothing.
 */
export async function dispatchDemoSchoolStart(db: DatabaseExecutor, jobId: string): Promise<boolean> {
  const [job] = await db
    .select({ attempt: demoSchoolJobTable.attempt })
    .from(demoSchoolJobTable)
    .where(
      and(
        eq(demoSchoolJobTable.id, jobId),
        eq(demoSchoolJobTable.status, "queued"),
        isNotNull(demoSchoolJobTable.startRequestedAt),
        isNull(demoSchoolJobTable.submittedAt),
        isNull(demoSchoolJobTable.purgeRequestedAt),
      ),
    )
    .limit(1);
  if (!job) return false;
  const fence = and(eq(demoSchoolJobTable.id, jobId), eq(demoSchoolJobTable.attempt, job.attempt));
  try {
    const { invocationId } = await sendDemoSchoolStart(jobId, job.attempt);
    await db
      .update(demoSchoolJobTable)
      .set({
        submittedAt: new Date(),
        submitInvocationId: invocationId,
        submitAttempts: sql`${demoSchoolJobTable.submitAttempts} + 1`,
        lastSubmitError: null,
      })
      .where(and(fence, isNull(demoSchoolJobTable.submittedAt)));
    return true;
  } catch (error) {
    await db
      .update(demoSchoolJobTable)
      .set({ submitAttempts: sql`${demoSchoolJobTable.submitAttempts} + 1`, lastSubmitError: describeHandoverError(error) })
      .where(and(fence, isNull(demoSchoolJobTable.submittedAt)));
    log.warn({ jobId, attempt: job.attempt, reason: describeHandoverError(error) }, "demo-school.start.handover.failed");
    return false;
  }
}

/** Sends the current attempt of a pending purge to Restate (same fences as starts). */
export async function dispatchDemoSchoolPurge(db: DatabaseExecutor, schoolId: string): Promise<boolean> {
  const [purge] = await db
    .select({ attempt: demoSchoolPurgeTable.attempt })
    .from(demoSchoolPurgeTable)
    .where(and(eq(demoSchoolPurgeTable.schoolId, schoolId), eq(demoSchoolPurgeTable.status, "pending")))
    .limit(1);
  if (!purge) return false;
  const fence = and(
    eq(demoSchoolPurgeTable.schoolId, schoolId),
    eq(demoSchoolPurgeTable.attempt, purge.attempt),
    eq(demoSchoolPurgeTable.status, "pending"),
  );
  try {
    const { invocationId } = await sendDemoSchoolPurge(schoolId, purge.attempt);
    // Conditional on `pending`: a send racing the workflow's own `completed`
    // or `failed` write never overwrites it.
    await db
      .update(demoSchoolPurgeTable)
      .set({
        status: "scheduled",
        scheduledAt: new Date(),
        submitInvocationId: invocationId,
        submitAttempts: sql`${demoSchoolPurgeTable.submitAttempts} + 1`,
        lastSubmitError: null,
      })
      .where(fence);
    return true;
  } catch (error) {
    await db
      .update(demoSchoolPurgeTable)
      .set({ submitAttempts: sql`${demoSchoolPurgeTable.submitAttempts} + 1`, lastSubmitError: describeHandoverError(error) })
      .where(fence);
    log.warn({ schoolId, attempt: purge.attempt, reason: describeHandoverError(error) }, "demo-school.purge.handover.failed");
    return false;
  }
}

/**
 * What an accepted run's Restate state means for a row that is not finished:
 * `paused` or ended (completed, or unknown to Restate) is a failure to show;
 * anything else is still progressing.
 */
function staleVerdict(status: RestateInvocationStatus | null): keyof typeof MESSAGES | null {
  if (status === "paused") return "paused";
  if (status === null || status === "completed") return "ended";
  return null;
}

/** Fails accepted jobs whose run Restate paused or that ended without finishing. */
async function failStaleJobs(db: DatabaseExecutor): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CHECK_AFTER_MS);
  const jobs = await db
    .select({
      id: demoSchoolJobTable.id,
      attempt: demoSchoolJobTable.attempt,
      currentStep: demoSchoolJobTable.currentStep,
      invocationId: demoSchoolJobTable.invocationId,
      submitInvocationId: demoSchoolJobTable.submitInvocationId,
    })
    .from(demoSchoolJobTable)
    .where(
      and(
        inArray(demoSchoolJobTable.status, ["queued", "running"]),
        isNull(demoSchoolJobTable.purgeRequestedAt),
        lt(demoSchoolJobTable.submittedAt, cutoff),
      ),
    )
    .orderBy(asc(demoSchoolJobTable.submittedAt))
    .limit(SWEEP_LIMIT);
  let failed = 0;
  for (const job of jobs) {
    // The workflow run once the control service recorded it, else the control call itself.
    const checked = job.invocationId ?? job.submitInvocationId;
    if (!checked) continue;
    const verdict = staleVerdict((await getRestateInvocation(checked))?.status ?? null);
    if (!verdict) continue;
    if (verdict === "paused") await cancelRestateInvocation(checked);
    // Fenced by the invocation that was checked: if the control service
    // recorded the workflow run meanwhile, this changes nothing.
    const sameInvocation: SQL | undefined = job.invocationId
      ? eq(demoSchoolJobTable.invocationId, job.invocationId)
      : isNull(demoSchoolJobTable.invocationId);
    const [row] = await db
      .update(demoSchoolJobTable)
      .set({ status: "failed", error: { step: job.currentStep ?? "start", message: MESSAGES[verdict] }, finishedAt: new Date() })
      .where(
        and(
          eq(demoSchoolJobTable.id, job.id),
          eq(demoSchoolJobTable.attempt, job.attempt),
          inArray(demoSchoolJobTable.status, ["queued", "running"]),
          isNull(demoSchoolJobTable.purgeRequestedAt),
          sameInvocation,
        ),
      )
      .returning({ id: demoSchoolJobTable.id });
    if (row) {
      failed += 1;
      log.warn({ jobId: job.id, attempt: job.attempt, verdict }, "demo-school.start.stale");
    }
  }
  return failed;
}

/** Fails scheduled purges whose run Restate paused or that ended without finishing. */
async function failStalePurges(db: DatabaseExecutor): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CHECK_AFTER_MS);
  const purges = await db
    .select({
      schoolId: demoSchoolPurgeTable.schoolId,
      attempt: demoSchoolPurgeTable.attempt,
      invocationId: demoSchoolPurgeTable.invocationId,
      submitInvocationId: demoSchoolPurgeTable.submitInvocationId,
    })
    .from(demoSchoolPurgeTable)
    .where(and(eq(demoSchoolPurgeTable.status, "scheduled"), lt(demoSchoolPurgeTable.scheduledAt, cutoff)))
    .orderBy(asc(demoSchoolPurgeTable.scheduledAt))
    .limit(SWEEP_LIMIT);
  let failed = 0;
  for (const purge of purges) {
    const checked = purge.invocationId ?? purge.submitInvocationId;
    if (!checked) continue;
    const verdict = staleVerdict((await getRestateInvocation(checked))?.status ?? null);
    if (!verdict) continue;
    if (verdict === "paused") await cancelRestateInvocation(checked);
    const sameInvocation: SQL | undefined = purge.invocationId
      ? eq(demoSchoolPurgeTable.invocationId, purge.invocationId)
      : isNull(demoSchoolPurgeTable.invocationId);
    const [row] = await db
      .update(demoSchoolPurgeTable)
      .set({ status: "failed", lastError: MESSAGES[verdict] })
      .where(
        and(
          eq(demoSchoolPurgeTable.schoolId, purge.schoolId),
          eq(demoSchoolPurgeTable.attempt, purge.attempt),
          eq(demoSchoolPurgeTable.status, "scheduled"),
          sameInvocation,
        ),
      )
      .returning({ id: demoSchoolPurgeTable.schoolId });
    if (row) {
      failed += 1;
      log.warn({ schoolId: purge.schoolId, attempt: purge.attempt, verdict }, "demo-school.purge.stale");
    }
  }
  return failed;
}

/**
 * Claims requested starts Restate has not accepted (`FOR UPDATE SKIP
 * LOCKED`, so replicas take disjoint rows) and fails those past the deadline
 * in the same short transaction. Returns the rest to send after commit.
 */
async function claimPendingStarts(db: DatabaseExecutor): Promise<string[]> {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: demoSchoolJobTable.id, startRequestedAt: demoSchoolJobTable.startRequestedAt })
      .from(demoSchoolJobTable)
      .where(
        and(
          eq(demoSchoolJobTable.status, "queued"),
          isNotNull(demoSchoolJobTable.startRequestedAt),
          isNull(demoSchoolJobTable.submittedAt),
          isNull(demoSchoolJobTable.purgeRequestedAt),
        ),
      )
      .orderBy(asc(demoSchoolJobTable.startRequestedAt))
      .limit(SWEEP_LIMIT)
      .for("update", { skipLocked: true });
    const deadline = Date.now() - START_HANDOVER_DEADLINE_MS;
    const expired = rows.filter((row) => row.startRequestedAt!.getTime() < deadline).map((row) => row.id);
    if (expired.length > 0) {
      await transaction
        .update(demoSchoolJobTable)
        .set({ status: "failed", error: { step: "start", message: MESSAGES.handoverFailed }, finishedAt: new Date() })
        .where(inArray(demoSchoolJobTable.id, expired));
      log.warn({ jobIds: expired }, "demo-school.start.handover.expired");
    }
    return rows.filter((row) => !expired.includes(row.id)).map((row) => row.id);
  });
}

/**
 * Claims purges to send: `pending` ones and `failed` ones still under
 * {@link MAX_AUTOMATIC_PURGE_ATTEMPTS}, which move to `pending` under the next
 * attempt. Failed purges past that stay `failed` for an admin to retry.
 * A pending purge has no hand-over deadline (unlike a start): the school is
 * already frozen, so failing it would help nobody. It stays visible instead:
 * the admin list shows pending purges with their last hand-over error.
 */
async function claimPendingPurges(db: DatabaseExecutor): Promise<string[]> {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        schoolId: demoSchoolPurgeTable.schoolId,
        status: demoSchoolPurgeTable.status,
        attempt: demoSchoolPurgeTable.attempt,
      })
      .from(demoSchoolPurgeTable)
      .where(
        or(
          eq(demoSchoolPurgeTable.status, "pending"),
          and(
            eq(demoSchoolPurgeTable.status, "failed"),
            lt(demoSchoolPurgeTable.attempt, MAX_AUTOMATIC_PURGE_ATTEMPTS),
            // Back off: attempt n is retried n × 2 minutes after it was accepted.
            or(
              isNull(demoSchoolPurgeTable.scheduledAt),
              sql`${demoSchoolPurgeTable.scheduledAt} < now() - make_interval(mins => 2 * ${demoSchoolPurgeTable.attempt})`,
            ),
          ),
        ),
      )
      .orderBy(asc(demoSchoolPurgeTable.createdAt), asc(demoSchoolPurgeTable.schoolId))
      .limit(SWEEP_LIMIT)
      .for("update", { skipLocked: true });
    const toSend: string[] = [];
    for (const row of rows) {
      if (row.status === "failed") {
        await transaction
          .update(demoSchoolPurgeTable)
          .set({ status: "pending", attempt: row.attempt + 1, invocationId: null, submitInvocationId: null, scheduledAt: null })
          .where(and(eq(demoSchoolPurgeTable.schoolId, row.schoolId), eq(demoSchoolPurgeTable.status, "failed")));
      }
      toSend.push(row.schoolId);
    }
    return toSend;
  });
}

/**
 * One outbox sweep, safe across API replicas and bounded per kind. Sends run
 * after the claiming transaction commits, so the control service sees the
 * rows; a replica sending the same attempt again joins one invocation.
 */
export async function sweepDemoSchoolOutbox(db: DatabaseExecutor = defaultDb) {
  const starts = await claimPendingStarts(db);
  let started = 0;
  for (const jobId of starts) if (await dispatchDemoSchoolStart(db, jobId)) started += 1;
  const purges = await claimPendingPurges(db);
  let purgesSent = 0;
  for (const schoolId of purges) if (await dispatchDemoSchoolPurge(db, schoolId)) purgesSent += 1;
  const staleJobs = await failStaleJobs(db);
  const stalePurges = await failStalePurges(db);
  return { starts: starts.length, started, purges: purges.length, purgesSent, staleJobs, stalePurges };
}
