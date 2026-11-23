import * as restate from '@restatedev/restate-sdk';
import { ORPCError } from '@orpc/server';
import { ZodError } from 'zod';

import { isRetryableTransactionError } from '../../errors';
import { SCHOOL_SETUP_RUN_STEPS, type SchoolSetupRunStep } from '../../school-setup/school-setup.contract';
import {
  SchoolSetupStepError,
  loadSchoolSetup,
  markSchoolSetupFailed,
  markSchoolSetupRunning,
  markSchoolSetupStep,
  markSchoolSetupSucceeded,
  readSchoolSetupResult,
  runSchoolSetupStep,
} from '../../school-setup/school-setup.service';
import { assertSchoolSetupActor } from './actor';
import { SCHOOL_SETUP_WORKFLOW_NAME, schoolSetupWorkflowInputSchema, schoolSetupWorkflowKey, type SchoolSetupWorkflowInput } from './constants';
import { log } from './log';

/** Error code marking a deterministic failure whose message is safe to show. */
const SAFE_FAILURE_CODE = 422;

/** Bounded retries for transient failures (network, S3, serialization aborts, OPA). */
const STEP_OPTIONS = { maxRetryAttempts: 6, initialRetryInterval: 1_000, retryIntervalFactor: 2, maxRetryInterval: 30_000 } as const;

const UNEXPECTED = 'A database or storage operation failed; the worker log has the details.';

/** Deterministic failures become terminal at once; anything else is retried. */
function classify(error: unknown): unknown {
  if (error instanceof restate.TerminalError) return error;
  if (error instanceof SchoolSetupStepError) return new restate.TerminalError(error.message, { errorCode: SAFE_FAILURE_CODE });
  if (error instanceof ZodError) return new restate.TerminalError('The saved setup is invalid.', { errorCode: SAFE_FAILURE_CODE });
  if (error instanceof ORPCError && error.status >= 400 && error.status < 500 && !isRetryableTransactionError(error.cause)) {
    return new restate.TerminalError(error.message, { errorCode: SAFE_FAILURE_CODE });
  }
  return error;
}

/** Journals one step; Restate stores the error text, so unexpected errors are replaced by a generic one. */
function step<T>(ctx: restate.WorkflowContext, name: string, action: () => Promise<T>) {
  return ctx.run(
    name,
    async () => {
      try {
        return await action();
      } catch (error) {
        const classified = classify(error);
        if (classified instanceof restate.TerminalError) throw classified;
        const detail = error instanceof Error ? { name: error.name, message: error.message.split('\nparams:')[0]!.slice(0, 500) } : String(error);
        log.error({ key: ctx.key, step: name, err: detail }, 'school-setup.step.error');
        throw new Error(UNEXPECTED);
      }
    },
    STEP_OPTIONS,
  );
}

export type SchoolSetupWorkflowOutput = { status: 'succeeded' | 'refused' };

/**
 * `SchoolSetup` sets up one real school from an admin's saved setup
 * (docs/school-onboarding-form.md). The key is `{setupId}.{attempt}` and must
 * match the input. It refuses a setup that is gone, finished or on another
 * attempt. Every step re-checks that the admin may still run it, then runs
 * as one transaction that records its own completion
 * (`school-setup.service.ts`), so a replay or a retry continues where the
 * last run stopped and never creates anything twice. Progress and the
 * outcome are written to `school_setup`, fenced by attempt. Private to
 * ingress: only `SchoolSetupControl`, which checks the row first, starts it.
 */
export const schoolSetupWorkflow = restate.workflow({
  name: SCHOOL_SETUP_WORKFLOW_NAME,
  options: { ingressPrivate: true },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: SchoolSetupWorkflowInput): Promise<SchoolSetupWorkflowOutput> => {
      const parsed = schoolSetupWorkflowInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid school setup input.', { errorCode: 400 });
      const { setupId, attempt } = parsed.data;
      if (ctx.key !== schoolSetupWorkflowKey(setupId, attempt)) throw new restate.TerminalError('The workflow key does not match the setup attempt.', { errorCode: 400 });
      let current: SchoolSetupRunStep | 'start' = 'start';
      try {
        const setup = await step(ctx, 'load', () => loadSchoolSetup(setupId).then((row) => (row ? { attempt: row.attempt, status: row.status } : null)));
        if (!setup || setup.attempt !== attempt || (setup.status !== 'queued' && setup.status !== 'running')) {
          log.warn({ setupId, attempt, status: setup?.status }, 'school-setup.refused');
          return { status: 'refused' };
        }
        const now = new Date(await ctx.date.now());
        const started = await step(ctx, 'start', () => markSchoolSetupRunning(setupId, attempt, now));
        if (!started) return { status: 'refused' };
        for (const name of SCHOOL_SETUP_RUN_STEPS) {
          current = name;
          await step(ctx, `begin:${name}`, () => markSchoolSetupStep(setupId, attempt, name));
          await step(ctx, name, async () => {
            await assertSchoolSetupActor(setupId);
            await runSchoolSetupStep(setupId, attempt, name, now);
          });
        }
        await step(ctx, 'finish', async () => {
          const result = await readSchoolSetupResult(setupId);
          await markSchoolSetupSucceeded(setupId, attempt, result, new Date());
        });
        log.info({ setupId, attempt }, 'school-setup.succeeded');
        return { status: 'succeeded' };
      } catch (error) {
        if (error instanceof restate.TerminalError) {
          const message =
            error instanceof restate.CancelledError
              ? 'The setup was cancelled.'
              : error.code === SAFE_FAILURE_CODE
                ? error.message
                : 'An unexpected error stopped this step. Retry; if it fails again, check the worker logs.';
          const failedStep = current;
          await ctx.run('mark-failed', () => markSchoolSetupFailed(setupId, attempt, { step: failedStep, message }, new Date()));
          log.warn({ setupId, attempt, step: failedStep }, 'school-setup.failed');
        }
        throw error;
      }
    },
  },
});

export type SchoolSetupWorkflow = typeof schoolSetupWorkflow;
