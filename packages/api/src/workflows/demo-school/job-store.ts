import { db } from '@campuspilot/db';
import {
  demoSchoolJobTable,
  type DemoSchoolJobError,
  type DemoSchoolJobResult,
} from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import { and, eq, inArray, sql } from 'drizzle-orm';

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
  requestedBy: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
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
    status: row.job.status,
    input: demoSeedInputSchema.parse(row.job.input),
    seed: row.job.seed,
    asOf: row.job.asOf?.toISOString() ?? null,
    attempt: row.job.attempt,
    school: row.school,
  };
}

/**
 * Every status write below is fenced by attempt: only the job's current
 * attempt, while it is not finished, may change it. A stale or replayed run
 * of an earlier attempt therefore matches no row and changes nothing.
 */
function currentAttempt(jobId: string, attempt: number) {
  return and(
    eq(demoSchoolJobTable.id, jobId),
    eq(demoSchoolJobTable.attempt, attempt),
    inArray(demoSchoolJobTable.status, ['queued', 'running']),
  );
}

/**
 * Records the seed and `asOf` the first time any attempt runs. Later attempts
 * keep the stored values (the `COALESCE`s), so a retry regenerates the same
 * people, dates and amounts and every idempotent step finds its earlier work.
 */
export async function startDemoJob(jobId: string, attempt: number, candidate: { seed: string; asOf: string }) {
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
    .where(currentAttempt(jobId, attempt))
    .returning({ seed: demoSchoolJobTable.seed, asOf: demoSchoolJobTable.asOf });
  if (!row?.seed || !row.asOf) return null;
  return { seed: row.seed, asOf: row.asOf.toISOString() };
}

export async function markDemoStepStarted(jobId: string, attempt: number, step: DemoSchoolStep) {
  await db.update(demoSchoolJobTable).set({ currentStep: step }).where(currentAttempt(jobId, attempt));
}

/** Appends a finished step once; replays do not duplicate it. */
export async function markDemoStepCompleted(jobId: string, attempt: number, step: DemoSchoolStep) {
  await db
    .update(demoSchoolJobTable)
    .set({
      completedSteps: sql`CASE WHEN ${demoSchoolJobTable.completedSteps} ? ${step} THEN ${demoSchoolJobTable.completedSteps} ELSE ${demoSchoolJobTable.completedSteps} || ${JSON.stringify([step])}::jsonb END`,
    })
    .where(currentAttempt(jobId, attempt));
}

export async function markDemoJobSucceeded(jobId: string, attempt: number, result: DemoSchoolJobResult) {
  await db
    .update(demoSchoolJobTable)
    .set({ status: 'succeeded', result, currentStep: null, error: null, finishedAt: new Date() })
    .where(currentAttempt(jobId, attempt));
}

export async function markDemoJobFailed(jobId: string, attempt: number, error: DemoSchoolJobError) {
  await db
    .update(demoSchoolJobTable)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(currentAttempt(jobId, attempt));
}
