import { db } from '@campuspilot/db';
import { dataMigrationRunTable } from '@campuspilot/db/schema/data-migration';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray } from 'drizzle-orm';

import { findDataMigration } from '../../data-migrations/registry';
import { authenticateControlCall } from '../control-service-auth';
import { DATA_MIGRATION_CONTROL_SERVICE_NAME, dataMigrationWorkflowKey } from './constants';
import { dataMigrationRunInputSchema, type DataMigrationRunInput } from './input';
import { log } from './log';
import { dataMigrationWorkflow } from './workflow';

/** Handlers of `DataMigrationControl`; each signature is bound to one. */
export type DataMigrationControlHandler = 'start';

/** A database step with bounded retries and a generic failure text (no SQL). */
function safeRun<T>(ctx: restate.Context, name: string, action: () => Promise<T>) {
  return ctx.run(name, async () => {
    try {
      return await action();
    } catch (error) {
      log.error({ service: DATA_MIGRATION_CONTROL_SERVICE_NAME, step: name, err: error instanceof Error ? error.name : 'unknown' }, 'data-migration.control.error');
      throw new Error('A database operation failed; the worker log has the details.');
    }
  }, { maxRetryAttempts: 5 });
}

/**
 * `DataMigrationControl` is the only data migration service reachable
 * through Restate ingress; the workflow is `ingressPrivate`. The API hands a
 * run over with a one-way, idempotent, signed send (an API request or the
 * boot never waits for the worker). `start` is, in order: Zod-parsed,
 * authenticated by its HMAC signature (`WORKER_CONTROL_SECRET`), then checked
 * against the database (the run exists and is pending or running, else a
 * terminal 409; its migration is registered in this worker's code, else a
 * retryable error until a worker that knows it answers), and only then starts the
 * workflow under the run's key and records its invocation ID, which the
 * API's sweep uses to notice a run Restate paused or that ended early.
 */
export const dataMigrationControlService = restate.service({
  name: DATA_MIGRATION_CONTROL_SERVICE_NAME,
  handlers: {
    start: async (ctx: restate.Context, rawInput: DataMigrationRunInput): Promise<{ invocationId: string }> => {
      const parsed = dataMigrationRunInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid data migration request.', { errorCode: 400 });
      const input = parsed.data;
      await authenticateControlCall(ctx, { service: DATA_MIGRATION_CONTROL_SERVICE_NAME, handler: 'start', input, log });
      const run = await safeRun(ctx, 'validate-run', async () => {
        const [row] = await db
          .select({ id: dataMigrationRunTable.id, migrationId: dataMigrationRunTable.migrationId })
          .from(dataMigrationRunTable)
          .where(and(eq(dataMigrationRunTable.id, input.runId), inArray(dataMigrationRunTable.status, ['pending', 'running'])))
          .limit(1);
        return row ?? null;
      });
      if (!run) throw new restate.TerminalError('No pending or running data migration run matches this request.', { errorCode: 409 });
      if (!findDataMigration(run.migrationId)) {
        // Retryable, not terminal: the API is often deployed before the
        // worker, so the run was handed over to an older worker release.
        // Restate retries this call with backoff until the new worker
        // answers it; if its retry policy pauses the call first, the API's
        // sweep fails the run visibly ("paused … is the worker running?")
        // and the next API boot registers a new run.
        log.warn({ runId: run.id, migrationId: run.migrationId }, 'data-migration.control.unknown-migration');
        throw new Error('This worker does not know the migration yet; is it running an older release?');
      }
      const handle = ctx
        .workflowSendClient(dataMigrationWorkflow, dataMigrationWorkflowKey(run.migrationId, run.id))
        .run(input);
      const invocationId = await handle.invocationId;
      await safeRun(ctx, 'record-invocation', async () => {
        await db
          .update(dataMigrationRunTable)
          .set({ invocationId, updatedAt: new Date() })
          .where(eq(dataMigrationRunTable.id, run.id));
      });
      return { invocationId };
    },
  },
});

export type DataMigrationControlService = typeof dataMigrationControlService;
