import * as restate from '@restatedev/restate-sdk';

import { findDataMigration } from '../../data-migrations/registry';
import {
  completeDataMigrationRun,
  DataMigrationError,
  failDataMigrationRun,
  loadDataMigrationRun,
  runDataMigrationBatch,
  startDataMigrationRun,
} from '../../data-migrations/run-store';
import type { DataMigration } from '../../data-migrations/types';
import { DATA_MIGRATION_WORKFLOW_NAME, dataMigrationWorkflowKey } from './constants';
import { dataMigrationRunInputSchema, type DataMigrationRunInput } from './input';
import { log } from './log';

/** Error code marking a deterministic failure whose message is safe to show. */
const SAFE_FAILURE_CODE = 422;
const UNEXPECTED_FAILURE = 'A database operation failed repeatedly; the worker log has the details.';

/** Bounded retries for transient failures (connection loss, serialization aborts). */
const STEP_OPTIONS = {
  maxRetryAttempts: 8,
  initialRetryInterval: 1_000,
  retryIntervalFactor: 2,
  maxRetryInterval: 60_000,
} as const;

/** Error details for the log only: the message before any SQL parameters and the database code. */
function describe(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error).slice(0, 300) };
  const cause = error.cause as { code?: unknown } | undefined;
  return {
    name: error.name,
    message: error.message.split('\nparams:')[0]!.slice(0, 500),
    code: typeof cause?.code === 'string' ? cause.code : undefined,
  };
}

/**
 * Runs one journaled unit. Deterministic failures become terminal at once;
 * anything else is replaced by a generic retryable error so Restate's failure
 * text never contains SQL, parameters or row contents.
 */
function step<T>(ctx: restate.WorkflowContext, name: string, action: () => Promise<T>) {
  return ctx.run(name, async () => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof restate.TerminalError) throw error;
      if (error instanceof DataMigrationError) throw new restate.TerminalError(error.message, { errorCode: SAFE_FAILURE_CODE });
      log.error({ workflow: DATA_MIGRATION_WORKFLOW_NAME, key: ctx.key, step: name, err: describe(error) }, 'data-migration.step.error');
      throw new Error(UNEXPECTED_FAILURE);
    }
  }, STEP_OPTIONS);
}

/** Runs one named unit of work; Restate journals it, tests call it directly. */
export type DataMigrationStepRunner = <T>(name: string, action: () => Promise<T>) => Promise<T>;

/**
 * The batch loop shared by the workflow and the integration tests. Every
 * batch is one step; the checkpoint lives on the run row (see
 * `runDataMigrationBatch`), so a crash anywhere resumes after the last
 * committed batch, and a replayed step simply runs the next batch.
 */
export async function runDataMigrationBatches(options: {
  runId: string;
  migration: DataMigration;
  step: DataMigrationStepRunner;
}): Promise<'completed' | 'stopped'> {
  const { runId, migration, step: run } = options;
  for (let batch = 1; ; batch += 1) {
    const outcome = await run(`batch:${batch}`, () => runDataMigrationBatch(runId, migration));
    if (outcome.state === 'stopped') return 'stopped';
    if (outcome.state === 'done') break;
  }
  await run('complete', () => completeDataMigrationRun(runId));
  return 'completed';
}

export type DataMigrationWorkflowOutput = { status: 'completed' | 'refused' | 'stopped' };

/**
 * `DataMigration` runs one requested run of a registered data migration
 * (plan Phase 1a, D-31). Its key is `{migrationId}/{runId}` and must match
 * the run row, so a run executes once. It is private to ingress: only
 * `DataMigrationControl`, which validates the run first, starts it. It
 * refuses a run that is no longer pending or running. A terminal failure is
 * recorded on the run with a safe message; a platform admin can request a new
 * run (or the next deploy registers one).
 */
export const dataMigrationWorkflow = restate.workflow({
  name: DATA_MIGRATION_WORKFLOW_NAME,
  options: { ingressPrivate: true },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: DataMigrationRunInput): Promise<DataMigrationWorkflowOutput> => {
      const parsed = dataMigrationRunInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid data migration input.', { errorCode: 400 });
      const { runId } = parsed.data;
      try {
        const started = await step(ctx, 'start', async () => {
          const run = await loadDataMigrationRun(runId);
          if (!run) return null;
          if (ctx.key !== dataMigrationWorkflowKey(run.migrationId, run.id)) {
            throw new DataMigrationError('The workflow key does not match the run.');
          }
          if (!findDataMigration(run.migrationId)) {
            throw new DataMigrationError('This migration is no longer registered in the code.');
          }
          const running = await startDataMigrationRun(runId);
          return running ? { migrationId: running.migrationId, dryRun: running.dryRun } : null;
        });
        if (!started) {
          log.warn({ runId }, 'data-migration.run.refused');
          return { status: 'refused' };
        }
        const migration = findDataMigration(started.migrationId)!;
        const status = await runDataMigrationBatches({ runId, migration, step: (name, action) => step(ctx, name, action) });
        log.info({ runId, migrationId: started.migrationId, dryRun: started.dryRun, status }, 'data-migration.run.finished');
        return { status };
      } catch (error) {
        if (error instanceof restate.TerminalError) {
          const message = error instanceof restate.CancelledError
            ? 'The run was cancelled.'
            : error.code === SAFE_FAILURE_CODE
              ? error.message
              : UNEXPECTED_FAILURE;
          await ctx.run('mark-failed', () => failDataMigrationRun(runId, message));
          log.warn({ runId, message }, 'data-migration.run.failed');
        }
        throw error;
      }
    },
  },
});

export type DataMigrationWorkflow = typeof dataMigrationWorkflow;
