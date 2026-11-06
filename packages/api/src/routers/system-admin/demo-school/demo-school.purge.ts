import { db as defaultDb, type DatabaseExecutor } from "@campuspilot/db";
import { demoSchoolPurgeTable } from "@campuspilot/db/schema/demo-school-job";
import { eq, sql } from "drizzle-orm";

import { log } from "../../../workflows/demo-school/log";
import { submitDemoSchoolPurgeWorkflow } from "./demo-school.restate";

/**
 * Submits S3 cleanup for one committed purge manifest and records the result.
 * Returns false (manifest stays `pending`) when Restate is unavailable; the
 * outbox sweep below submits it again later.
 */
export async function scheduleDemoSchoolPurgeCleanup(db: DatabaseExecutor, schoolId: string): Promise<boolean> {
  try {
    await submitDemoSchoolPurgeWorkflow(schoolId);
    await db
      .update(demoSchoolPurgeTable)
      .set({ status: "scheduled", scheduledAt: new Date(), submitAttempts: sql`${demoSchoolPurgeTable.submitAttempts} + 1` })
      .where(eq(demoSchoolPurgeTable.schoolId, schoolId));
    return true;
  } catch (error) {
    await db
      .update(demoSchoolPurgeTable)
      .set({ submitAttempts: sql`${demoSchoolPurgeTable.submitAttempts} + 1` })
      .where(eq(demoSchoolPurgeTable.schoolId, schoolId));
    log.error({ err: error, schoolId }, "demo-school.purge.s3-schedule.failed");
    return false;
  }
}

/**
 * Outbox sweep: resubmits every purge whose S3 cleanup was never accepted by
 * Restate. Safe to run on every API instance; the workflow is keyed by school.
 */
export async function resubmitPendingDemoPurges(db: DatabaseExecutor = defaultDb): Promise<{ pending: number; scheduled: number }> {
  const pending = await db
    .select({ schoolId: demoSchoolPurgeTable.schoolId })
    .from(demoSchoolPurgeTable)
    .where(eq(demoSchoolPurgeTable.status, "pending"));
  let scheduled = 0;
  for (const { schoolId } of pending) {
    if (await scheduleDemoSchoolPurgeCleanup(db, schoolId)) scheduled += 1;
  }
  return { pending: pending.length, scheduled };
}
