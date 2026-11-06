import { db } from '@campuspilot/db';
import {
  demoSchoolJobTable,
  type DemoSchoolJobError,
  type DemoSchoolJobResult,
} from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import { eq, sql } from 'drizzle-orm';

import type { DemoSchoolStep } from './constants';
import { demoSeedInputSchema, type DemoSeedInput } from './plan';

/**
 * Reads and writes the product status row (`demo_school_job`). Restate is not
 * the status database; the admin UI polls this row. Writes after a purge find
 * no row and are deliberately no-ops.
 */

export type DemoJobSnapshot = {
  jobId: string;
  schoolId: string;
  requestedBy: string;
  input: DemoSeedInput;
  seed: string | null;
  asOf: string | null;
  attempt: number;
  school: { slug: string; name: string; logoS3Key: string | null };
};

export async function loadDemoJob(jobId: string): Promise<DemoJobSnapshot | null> {
  const [row] = await db
    .select({ job: demoSchoolJobTable, school: { slug: schoolTable.slug, name: schoolTable.name, logoS3Key: schoolTable.logoS3Key } })
    .from(demoSchoolJobTable)
    .innerJoin(schoolTable, eq(schoolTable.id, demoSchoolJobTable.schoolId))
    .where(eq(demoSchoolJobTable.id, jobId))
    .limit(1);
  if (!row) return null;
  return {
    jobId,
    schoolId: row.job.schoolId,
    requestedBy: row.job.requestedBy,
    input: demoSeedInputSchema.parse(row.job.input),
    seed: row.job.seed,
    asOf: row.job.asOf?.toISOString() ?? null,
    attempt: row.job.attempt,
    school: row.school,
  };
}

/**
 * Records the seed and `asOf` the first time any attempt runs. Later attempts
 * keep the stored values (the `COALESCE`s), so a retry regenerates the same
 * people, dates and amounts and every idempotent step finds its earlier work.
 */
export async function startDemoJob(jobId: string, candidate: { seed: string; asOf: string }) {
  const [row] = await db
    .update(demoSchoolJobTable)
    .set({
      status: 'running',
      seed: sql`COALESCE(${demoSchoolJobTable.seed}, ${candidate.seed})`,
      asOf: sql`COALESCE(${demoSchoolJobTable.asOf}, ${candidate.asOf}::timestamptz)`,
      startedAt: sql`COALESCE(${demoSchoolJobTable.startedAt}, now())`,
      error: null,
      finishedAt: null,
    })
    .where(eq(demoSchoolJobTable.id, jobId))
    .returning({ seed: demoSchoolJobTable.seed, asOf: demoSchoolJobTable.asOf });
  if (!row?.seed || !row.asOf) return null;
  return { seed: row.seed, asOf: row.asOf.toISOString() };
}

export async function markDemoStepStarted(jobId: string, step: DemoSchoolStep) {
  await db.update(demoSchoolJobTable).set({ currentStep: step }).where(eq(demoSchoolJobTable.id, jobId));
}

/** Appends a finished step once; replays do not duplicate it. */
export async function markDemoStepCompleted(jobId: string, step: DemoSchoolStep) {
  await db
    .update(demoSchoolJobTable)
    .set({
      completedSteps: sql`CASE WHEN ${demoSchoolJobTable.completedSteps} ? ${step} THEN ${demoSchoolJobTable.completedSteps} ELSE ${demoSchoolJobTable.completedSteps} || ${JSON.stringify([step])}::jsonb END`,
    })
    .where(eq(demoSchoolJobTable.id, jobId));
}

export async function markDemoJobSucceeded(jobId: string, result: DemoSchoolJobResult) {
  await db
    .update(demoSchoolJobTable)
    .set({ status: 'succeeded', result, currentStep: null, error: null, finishedAt: new Date() })
    .where(eq(demoSchoolJobTable.id, jobId));
}

export async function markDemoJobFailed(jobId: string, error: DemoSchoolJobError) {
  await db
    .update(demoSchoolJobTable)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(eq(demoSchoolJobTable.id, jobId));
}
