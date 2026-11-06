import * as restate from '@restatedev/restate-sdk';
import { ORPCError } from '@orpc/server';
import { randomBytes } from 'node:crypto';

import { isRetryableTransactionError } from '../../errors';
import { DEMO_SCHOOL_WORKFLOW_NAME, type DemoSchoolStep } from './constants';
import { DemoJobGuardError } from './job-context';
import type { DemoSchoolJobResult } from '@campuspilot/db/schema/demo-school-job';
import {
  loadDemoJob,
  markDemoJobFailed,
  markDemoJobSucceeded,
  markDemoStepCompleted,
  markDemoStepStarted,
  startDemoJob,
  type DemoJobSnapshot,
} from './job-store';
import { log } from './log';
import { buildDemoPlan } from './plan';
import {
  createSeedContext,
  DemoSeedError,
  finishDemoSchool,
  seedBillingMonth,
  seedClass,
  seedClassStudents,
  seedCredentials,
  seedExamClassResults,
  seedExamCompletion,
  seedExamSetup,
  seedFinanceConfiguration,
  seedSchoolLogo,
  seedSession,
  seedStaffMember,
  seedTemplates,
  seedUnregistrations,
  verifyFinanceProjections,
} from './steps';

/** Error code marking a deterministic seed failure whose message is safe to show. */
const SAFE_FAILURE_CODE = 422;

/** Bounded retries for transient failures (network, S3, serialization aborts). */
const STEP_OPTIONS = {
  maxRetryAttempts: 6,
  initialRetryInterval: 1_000,
  retryIntervalFactor: 2,
  maxRetryInterval: 30_000,
} as const;

/**
 * Deterministic failures become terminal immediately so the job reports them
 * instead of retrying: seed and guard errors, and client errors from the
 * procedures — except finance serialization conflicts, which are transient.
 */
function classify(error: unknown): unknown {
  if (error instanceof DemoSeedError || error instanceof DemoJobGuardError) {
    return new restate.TerminalError(error.message, { errorCode: SAFE_FAILURE_CODE });
  }
  if (error instanceof ORPCError && error.status >= 400 && error.status < 500 && !isRetryableTransactionError(error.cause)) {
    return new restate.TerminalError(error.message, { errorCode: SAFE_FAILURE_CODE });
  }
  return error;
}

function step<T>(ctx: restate.WorkflowContext, name: string, action: () => Promise<T>) {
  return ctx.run(
    name,
    async () => {
      try {
        return await action();
      } catch (error) {
        throw classify(error);
      }
    },
    STEP_OPTIONS,
  );
}

/** Runs one named, idempotent unit of work; Restate journals it, tests call it directly. */
export type DemoStepRunner = <T>(name: string, action: () => Promise<T>) => Promise<T>;

/**
 * The ordered seed (plan §6), shared by the Restate workflow and the
 * integration tests so both exercise exactly the same sequence. Every unit
 * goes through `step`, and only its small return value (IDs, counts) is kept.
 */
export async function runDemoSeedSteps(options: {
  job: DemoJobSnapshot;
  run: { seed: string; asOf: string };
  step: DemoStepRunner;
  onPhase?: (name: DemoSchoolStep) => void;
}): Promise<DemoSchoolJobResult> {
  const { job, run, step } = options;
  const jobId = job.jobId;
  const plan = buildDemoPlan({ input: job.input, seed: run.seed, asOf: new Date(run.asOf), school: job.school });
  const seed = () => createSeedContext(job, run);
  const phase = async (name: DemoSchoolStep, body: () => Promise<void>) => {
    options.onPhase?.(name);
    await step(`begin:${name}`, () => markDemoStepStarted(jobId, name));
    await body();
    await step(`end:${name}`, () => markDemoStepCompleted(jobId, name));
  };

  await phase('staff', async () => {
    await step('logo', async () => seedSchoolLogo(await seed()));
    for (const member of plan.staff) {
      await step(`staff:${member.key}`, async () => seedStaffMember(await seed(), member));
    }
  });

  let sessionId = '';
  await phase('session', async () => {
    ({ sessionId } = await step('session', async () => seedSession(await seed())));
  });

  const placements = new Map<string, { classId: string; sectionId: string }>();
  await phase('classes', async () => {
    for (const demoClass of plan.classes) {
      placements.set(demoClass.seed.slug, await step(`class:${demoClass.seed.slug}`, async () => seedClass(await seed(), sessionId, demoClass)));
    }
  });

  await phase('students', async () => {
    for (const demoClass of plan.classes) {
      const placement = placements.get(demoClass.seed.slug)!;
      await step(`students:${demoClass.seed.slug}`, async () => seedClassStudents(await seed(), { sessionId, ...placement, demoClass }));
    }
  });

  await phase('exams', async () => {
    for (const exam of plan.exams) {
      await step(`exam:${exam.slug}:setup`, async () => seedExamSetup(await seed(), sessionId, exam));
      for (const demoClass of plan.classes) {
        await step(`exam:${exam.slug}:results:${demoClass.seed.slug}`, async () => seedExamClassResults(await seed(), { sessionId, exam, demoClass }));
      }
      await step(`exam:${exam.slug}:complete`, async () => seedExamCompletion(await seed(), sessionId, exam));
    }
  });

  await phase('finance', async () => {
    await step('finance:configuration', async () => seedFinanceConfiguration(await seed(), sessionId));
    for (const month of plan.billingMonths) {
      await step(`finance:${month.periodKey}`, async () => seedBillingMonth(await seed(), sessionId, month.index));
    }
    await step('finance:reconcile', async () => verifyFinanceProjections(await seed()));
    await step('finance:unregister', async () => seedUnregistrations(await seed()));
  });

  await phase('templates', async () => {
    await step('templates', async () => seedTemplates(await seed()));
  });

  let credentialsS3Key = '';
  await phase('credentials', async () => {
    // One step generates, sets and stores every password and returns only
    // the S3 key, so no password is ever journaled.
    ({ credentialsS3Key } = await step('credentials', async () => seedCredentials(await seed())));
  });

  return step('finish', async () => {
    const result = await finishDemoSchool(await seed(), credentialsS3Key);
    await markDemoJobSucceeded(jobId, result);
    return result;
  });
}

export type DemoSchoolWorkflowInput = { jobId: string };
export type DemoSchoolWorkflowOutput = { status: 'succeeded' | 'missing' };

/**
 * `DemoSchool` provisions one demo school (plan §6). The key is
 * `{jobId}.{attempt}` (see `demoSchoolWorkflowKey`), so a repeat submit
 * attaches to the running attempt and a retry starts a new one that resumes
 * through idempotent steps. The seed and `asOf` are drawn once and stored on
 * the job, so every attempt rebuilds the same plan; only IDs and counts are
 * journaled. Progress and failures are written to `demo_school_job`.
 */
export const demoSchoolWorkflow = restate.workflow({
  name: DEMO_SCHOOL_WORKFLOW_NAME,
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: DemoSchoolWorkflowInput): Promise<DemoSchoolWorkflowOutput> => {
      const { jobId } = input;
      const job = await step(ctx, 'load-job', () => loadDemoJob(jobId));
      if (!job) return { status: 'missing' };
      const candidateSeed = await ctx.run('draw-seed', async () => randomBytes(16).toString('hex'));
      const now = await ctx.date.now();
      const run = await step(ctx, 'start-job', async () => {
        const started = await startDemoJob(jobId, { seed: candidateSeed, asOf: new Date(now).toISOString() });
        if (!started) throw new DemoSeedError('The demo job no longer exists.');
        return started;
      });
      let current: DemoSchoolStep = 'staff';
      try {
        const result = await runDemoSeedSteps({
          job,
          run,
          step: (name, action) => step(ctx, name, action),
          onPhase: (name) => {
            current = name;
          },
        });
        log.info({ jobId, schoolId: job.schoolId, counts: result.counts }, 'demo-school.seed.succeeded');
        return { status: 'succeeded' };
      } catch (error) {
        if (error instanceof restate.TerminalError) {
          const safe = error.code === SAFE_FAILURE_CODE;
          const message = error instanceof restate.CancelledError
            ? 'The seed was cancelled.'
            : safe
              ? error.message
              : 'An unexpected error stopped this step. Retry the job; if it fails again, check the worker logs.';
          const failedStep = current;
          await ctx.run('mark-failed', () => markDemoJobFailed(jobId, { step: failedStep, message }));
          log.warn({ jobId, schoolId: job.schoolId, step: failedStep, safe }, 'demo-school.seed.failed');
        }
        throw error;
      }
    },
  },
});

export type DemoSchoolWorkflow = typeof demoSchoolWorkflow;
