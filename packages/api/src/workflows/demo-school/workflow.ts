import * as restate from '@restatedev/restate-sdk';
import { ORPCError } from '@orpc/server';
import { randomBytes } from 'node:crypto';
import { ZodError, z } from 'zod';

import { isRetryableTransactionError } from '../../errors';
import { DEMO_SCHOOL_WORKFLOW_NAME, demoSchoolWorkflowKey, type DemoSchoolStep } from './constants';
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
import { toSafeError } from './safe-error';
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
  seedExamRelease,
  seedExamRemarks,
  seedExamSetup,
  seedFinanceConfiguration,
  seedNotice,
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
  // Invalid stored input or seed data never fixes itself on retry.
  if (error instanceof ZodError) {
    return new restate.TerminalError('The demo job input or seed data is invalid.', { errorCode: SAFE_FAILURE_CODE });
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
        throw toSafeError(classify(error), { workflow: DEMO_SCHOOL_WORKFLOW_NAME, key: ctx.key, step: name });
      }
    },
    STEP_OPTIONS,
  );
}

/** Workflow input; parsed before any journal entry so bad input is terminal at once. */
export const demoSchoolWorkflowInputSchema = z.object({
  jobId: z.string().regex(/^dsj_[a-z0-9]{21}$/),
  attempt: z.number().int().positive().max(1_000),
});

/** Runs one named, idempotent unit of work; Restate journals it, tests call it directly. */
export type DemoStepRunner = <T>(name: string, action: () => Promise<T>) => Promise<T>;

/**
 * The ordered seed (plan §6), shared by the Restate workflow and the
 * integration tests so both exercise exactly the same sequence. Every unit
 * goes through `step`, and only its small return value (IDs, counts) is kept.
 */
export async function runDemoSeedSteps(options: {
  job: DemoJobSnapshot;
  /** The attempt this run belongs to; every status write is fenced by it. */
  attempt: number;
  run: { seed: string; asOf: string };
  step: DemoStepRunner;
  onPhase?: (name: DemoSchoolStep) => void;
}): Promise<DemoSchoolJobResult> {
  const { job, run, step, attempt } = options;
  const jobId = job.jobId;
  const plan = buildDemoPlan({ input: job.input, seed: run.seed, asOf: new Date(run.asOf), school: job.school });
  const seed = () => createSeedContext(job, run);
  const phase = async (name: DemoSchoolStep, body: () => Promise<void>) => {
    options.onPhase?.(name);
    await step(`begin:${name}`, () => markDemoStepStarted(jobId, attempt, name));
    await body();
    await step(`end:${name}`, () => markDemoStepCompleted(jobId, attempt, name));
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
      for (const demoClass of plan.classes) {
        await step(`exam:${exam.slug}:remarks:${demoClass.seed.slug}`, async () => seedExamRemarks(await seed(), { sessionId, exam, demoClass }));
      }
      await step(`exam:${exam.slug}:release`, async () => seedExamRelease(await seed(), sessionId, exam));
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

  // After templates: publishing a plain notice pins the school's selected
  // Notice template revision, so the demo's notices use the seeded design.
  await phase('notices', async () => {
    const classIdsBySlug = Object.fromEntries([...placements].map(([slug, placement]) => [slug, placement.classId]));
    for (const notice of plan.notices) {
      await step(`notice:${notice.key}`, async () => seedNotice(await seed(), { sessionId, classIdsBySlug, notice }));
    }
  });

  let credentialsS3Key = '';
  await phase('credentials', async () => {
    // One step generates, sets and stores every password and returns only
    // the S3 key, so no password is ever journaled.
    ({ credentialsS3Key } = await step('credentials', async () => seedCredentials(await seed())));
  });

  return step('finish', async () => {
    const result = await finishDemoSchool(await seed(), credentialsS3Key);
    await markDemoJobSucceeded(jobId, attempt, result);
    return result;
  });
}

export type DemoSchoolWorkflowInput = { jobId: string; attempt: number };
export type DemoSchoolWorkflowOutput = { status: 'succeeded' | 'refused' };

/**
 * `DemoSchool` provisions one demo school (plan §6). The key is
 * `{jobId}.{attempt}` and must match the input, so a run can only act for the
 * attempt it was started as. It refuses a missing or finished job and any
 * attempt other than the job's current one, so it can never re-run a
 * succeeded seed. It is private to ingress: only `DemoSchoolControl`, which
 * validates the job row first, starts it. The seed and `asOf` are drawn once
 * and stored on the job, so every attempt rebuilds the same plan; only IDs and
 * counts are journaled. Progress and failures are written to
 * `demo_school_job`, fenced by attempt.
 */
export const demoSchoolWorkflow = restate.workflow({
  name: DEMO_SCHOOL_WORKFLOW_NAME,
  options: { ingressPrivate: true },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: DemoSchoolWorkflowInput): Promise<DemoSchoolWorkflowOutput> => {
      const parsed = demoSchoolWorkflowInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid demo seed input.', { errorCode: 400 });
      const { jobId, attempt } = parsed.data;
      if (ctx.key !== demoSchoolWorkflowKey(jobId, attempt)) {
        throw new restate.TerminalError('The workflow key does not match the job attempt.');
      }
      let current: DemoSchoolStep = 'staff';
      let schoolId: string | null = null;
      try {
        const job = await step(ctx, 'load-job', async () => {
          const loaded = await loadDemoJob(jobId);
          if (!loaded) throw new DemoSeedError('The demo job no longer exists.');
          return loaded;
        });
        schoolId = job.schoolId;
        if (job.attempt !== attempt || job.status === 'succeeded' || job.status === 'failed' || job.purgeRequestedAt) {
          log.warn({ jobId, attempt, currentAttempt: job.attempt, status: job.status }, 'demo-school.seed.refused');
          return { status: 'refused' };
        }
        const candidateSeed = await ctx.run('draw-seed', async () => randomBytes(16).toString('hex'));
        const now = await ctx.date.now();
        const run = await step(ctx, 'start-job', async () => {
          const started = await startDemoJob(jobId, attempt, { seed: candidateSeed, asOf: new Date(now).toISOString() });
          if (!started) throw new DemoSeedError('This attempt is no longer the current one.');
          return started;
        });
        const result = await runDemoSeedSteps({
          job,
          attempt,
          run,
          step: (name, action) => step(ctx, name, action),
          onPhase: (name) => {
            current = name;
          },
        });
        log.info({ jobId, schoolId, counts: result.counts }, 'demo-school.seed.succeeded');
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
          // Fenced by attempt: a no-op unless this is still the current attempt.
          await ctx.run('mark-failed', () => markDemoJobFailed(jobId, attempt, { step: failedStep, message }));
          log.warn({ jobId, schoolId, attempt, step: failedStep, safe }, 'demo-school.seed.failed');
        }
        throw error;
      }
    },
  },
});

export type DemoSchoolWorkflow = typeof demoSchoolWorkflow;
