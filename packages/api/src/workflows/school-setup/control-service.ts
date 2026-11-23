import { db } from '@campuspilot/db';
import { schoolSetupTable } from '@campuspilot/db/schema/school-setup';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray } from 'drizzle-orm';

import { authenticateControlCall } from '../control-service-auth';
import {
  SCHOOL_SETUP_CONTROL_SERVICE_NAME,
  schoolSetupWorkflowInputSchema,
  schoolSetupWorkflowKey,
  type SchoolSetupControlHandler,
  type SchoolSetupWorkflowInput,
} from './constants';
import { log } from './log';
import { schoolSetupWorkflow } from './workflow';

function databaseStep<T>(ctx: restate.Context, name: string, action: () => Promise<T>) {
  return ctx.run(
    name,
    async () => {
      try {
        return await action();
      } catch (error) {
        log.error({ service: SCHOOL_SETUP_CONTROL_SERVICE_NAME, step: name, err: error instanceof Error ? error.name : 'unknown' }, 'school-setup.control.error');
        throw new Error('A database operation failed; the worker log has the details.');
      }
    },
    { maxRetryAttempts: 5 },
  );
}

/**
 * `SchoolSetupControl` is the only school setup service reachable through
 * Restate ingress; the workflow is `ingressPrivate`. The API hands a setup
 * over with a one-way, idempotent, signed send, so no admin request waits for
 * the worker. `start` is, in order: Zod-parsed, authenticated by its HMAC
 * signature (`WORKER_CONTROL_SECRET`, bound to this service and handler),
 * checked against the database (that attempt is queued or running), and only
 * then starts the workflow under the attempt's key, recording its invocation.
 */
export const schoolSetupControlService = restate.service({
  name: SCHOOL_SETUP_CONTROL_SERVICE_NAME,
  handlers: {
    start: async (ctx: restate.Context, rawInput: SchoolSetupWorkflowInput): Promise<{ invocationId: string }> => {
      const parsed = schoolSetupWorkflowInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid school setup request.', { errorCode: 400 });
      const input = parsed.data;
      const handler: SchoolSetupControlHandler = 'start';
      await authenticateControlCall(ctx, { service: SCHOOL_SETUP_CONTROL_SERVICE_NAME, handler, input, log });
      const fence = and(eq(schoolSetupTable.id, input.setupId), eq(schoolSetupTable.attempt, input.attempt));
      const allowed = await databaseStep(ctx, 'validate-setup', async () => {
        const [row] = await db
          .select({ id: schoolSetupTable.id })
          .from(schoolSetupTable)
          .where(and(fence, inArray(schoolSetupTable.status, ['queued', 'running'])))
          .limit(1);
        return Boolean(row);
      });
      if (!allowed) throw new restate.TerminalError('No queued or running school setup matches this attempt.', { errorCode: 409 });
      const handle = ctx.workflowSendClient(schoolSetupWorkflow, schoolSetupWorkflowKey(input.setupId, input.attempt)).run(input);
      const invocationId = await handle.invocationId;
      await databaseStep(ctx, 'record-invocation', () => db.update(schoolSetupTable).set({ invocationId }).where(fence));
      return { invocationId };
    },
  },
});

export type SchoolSetupControlService = typeof schoolSetupControlService;
