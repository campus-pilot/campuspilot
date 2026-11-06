import { db as defaultDb, type DatabaseExecutor } from "@campuspilot/db";
import { demoSchoolPurgeTable } from "@campuspilot/db/schema/demo-school-job";
import { and, asc, eq, lt, or, sql } from "drizzle-orm";

import { log } from "../../../workflows/demo-school/log";
import { submitDemoSchoolPurgeWorkflow } from "./demo-school.restate";

/** Manifests handled per sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 20;
/** A terminally failed cleanup is retried this many times in total, then left `failed`. */
const MAX_CLEANUP_ATTEMPTS = 5;

/**
 * Submits the current S3 cleanup attempt of one committed purge manifest.
 * The `scheduled` write is conditional on `pending`, so a resubmission racing
 * the workflow's `completed` write can never overwrite it. Returns false
 * (manifest stays `pending`) when Restate or the worker is unavailable; the
 * outbox sweep submits it again later under the same idempotency key.
 */
export async function scheduleDemoSchoolPurgeCleanup(db: DatabaseExecutor, schoolId: string): Promise<boolean> {
  const [manifest] = await db
    .select({ attempt: demoSchoolPurgeTable.cleanupAttempt })
    .from(demoSchoolPurgeTable)
    .where(and(eq(demoSchoolPurgeTable.schoolId, schoolId), eq(demoSchoolPurgeTable.status, "pending")))
    .limit(1);
  if (!manifest) return false;
  try {
    await submitDemoSchoolPurgeWorkflow(schoolId, manifest.attempt);
    await db
      .update(demoSchoolPurgeTable)
      .set({ status: "scheduled", scheduledAt: new Date(), submitAttempts: sql`${demoSchoolPurgeTable.submitAttempts} + 1` })
      .where(and(eq(demoSchoolPurgeTable.schoolId, schoolId), eq(demoSchoolPurgeTable.status, "pending"), eq(demoSchoolPurgeTable.cleanupAttempt, manifest.attempt)));
    return true;
  } catch (error) {
    await db
      .update(demoSchoolPurgeTable)
      .set({ submitAttempts: sql`${demoSchoolPurgeTable.submitAttempts} + 1` })
      .where(eq(demoSchoolPurgeTable.schoolId, schoolId));
    log.error({ err: error instanceof Error ? { name: error.name, message: error.message } : String(error), schoolId }, "demo-school.purge.s3-schedule.failed");
    return false;
  }
}

/**
 * One outbox sweep, safe across API replicas and bounded:
 * 1. A short transaction claims at most {@link SWEEP_LIMIT} rows with
 *    `FOR UPDATE SKIP LOCKED` (concurrent sweeps take disjoint rows) and moves
 *    terminally `failed` cleanups back to `pending` under the next attempt,
 *    until {@link MAX_CLEANUP_ATTEMPTS}; after that they stay `failed` with
 *    `last_error` for an operator (the workflow logs each terminal failure as
 *    `demo-school.purge.s3.failed`).
 * 2. After that commit (so the control service sees the new attempt), each
 *    claimed `pending` cleanup is submitted. A replica that submits the same
 *    attempt again reuses one invocation through the idempotency key.
 */
export async function resubmitPendingDemoPurges(db: DatabaseExecutor = defaultDb): Promise<{ pending: number; scheduled: number }> {
  const claimed = await db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ schoolId: demoSchoolPurgeTable.schoolId, status: demoSchoolPurgeTable.status, attempt: demoSchoolPurgeTable.cleanupAttempt })
      .from(demoSchoolPurgeTable)
      .where(
        or(
          eq(demoSchoolPurgeTable.status, "pending"),
          and(eq(demoSchoolPurgeTable.status, "failed"), lt(demoSchoolPurgeTable.cleanupAttempt, MAX_CLEANUP_ATTEMPTS)),
        ),
      )
      .orderBy(asc(demoSchoolPurgeTable.createdAt), asc(demoSchoolPurgeTable.schoolId))
      .limit(SWEEP_LIMIT)
      .for("update", { skipLocked: true });
    for (const row of rows.filter((item) => item.status === "failed")) {
      await transaction
        .update(demoSchoolPurgeTable)
        .set({ status: "pending", cleanupAttempt: row.attempt + 1 })
        .where(and(eq(demoSchoolPurgeTable.schoolId, row.schoolId), eq(demoSchoolPurgeTable.status, "failed")));
    }
    return rows.map((row) => row.schoolId);
  });
  let scheduled = 0;
  for (const schoolId of claimed) {
    if (await scheduleDemoSchoolPurgeCleanup(db, schoolId)) scheduled += 1;
  }
  return { pending: claimed.length, scheduled };
}
