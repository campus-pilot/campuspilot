import { db } from '@campuspilot/db';
import { demoSchoolJobTable, demoSchoolPurgeTable } from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { DEMO_SCHOOL_CONTROL_SERVICE_NAME, demoSchoolWorkflowKey } from './constants';
import {
  demoSchoolPurgeInputSchema,
  demoSchoolPurgeWorkflow,
  demoSchoolPurgeWorkflowKey,
  type DemoSchoolPurgeInput,
} from './purge-workflow';
import { toSafeError } from './safe-error';
import { demoSchoolWorkflow, demoSchoolWorkflowInputSchema, type DemoSchoolWorkflowInput } from './workflow';

/** Runs a validation query with a safe failure text (no SQL or parameters). */
function safeRun<T>(ctx: restate.Context, name: string, action: () => Promise<T>) {
  return ctx.run(name, async () => {
    try {
      return await action();
    } catch (error) {
      throw toSafeError(error, { service: DEMO_SCHOOL_CONTROL_SERVICE_NAME, step: name });
    }
  }, { maxRetryAttempts: 5 });
}

/**
 * `DemoSchoolControl` is the only demo service reachable through Restate
 * ingress; both workflows are `ingressPrivate`. The API calls it through the
 * ingress client (Restate OSS cannot authenticate ingress callers, so the
 * workflows cannot be reached by any other path the API could use). Every
 * input is parsed with Zod before any journal entry, so malformed calls fail
 * terminally at once instead of retrying. It starts a workflow only for state
 * the database already authorises, so a caller reaching ingress can do no more
 * than the API would:
 * - `startSeed` runs the job's current attempt while it is queued or running
 *   and no purge was requested;
 * - `startPurgeCleanup` runs S3 cleanup only for the current cleanup attempt
 *   of a committed purge manifest of a school that no longer exists.
 * The workflows re-check the same facts themselves. Ingress and the admin API
 * must still never be publicly reachable (docs/demo-school.md).
 */
export const demoSchoolControlService = restate.service({
  name: DEMO_SCHOOL_CONTROL_SERVICE_NAME,
  handlers: {
    startSeed: async (ctx: restate.Context, rawInput: DemoSchoolWorkflowInput): Promise<{ invocationId: string }> => {
      const parsed = demoSchoolWorkflowInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid demo seed request.', { errorCode: 400 });
      const input = parsed.data;
      const allowed = await safeRun(ctx, 'validate-job', async () => {
        const [job] = await db
          .select({ id: demoSchoolJobTable.id })
          .from(demoSchoolJobTable)
          .where(
            and(
              eq(demoSchoolJobTable.id, input.jobId),
              eq(demoSchoolJobTable.attempt, input.attempt),
              inArray(demoSchoolJobTable.status, ['queued', 'running']),
              isNull(demoSchoolJobTable.purgeRequestedAt),
            ),
          )
          .limit(1);
        return Boolean(job);
      });
      if (!allowed) throw new restate.TerminalError('No queued or running demo job matches this attempt.', { errorCode: 409 });
      const handle = ctx
        .workflowSendClient(demoSchoolWorkflow, demoSchoolWorkflowKey(input.jobId, input.attempt))
        .run(input);
      return { invocationId: await handle.invocationId };
    },

    startPurgeCleanup: async (ctx: restate.Context, rawInput: DemoSchoolPurgeInput): Promise<{ invocationId: string }> => {
      const parsed = demoSchoolPurgeInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid purge cleanup request.', { errorCode: 400 });
      const input = parsed.data;
      const allowed = await safeRun(ctx, 'validate-manifest', async () => {
        const [school] = await db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, input.schoolId)).limit(1);
        if (school) return false;
        const [manifest] = await db
          .select({ id: demoSchoolPurgeTable.schoolId })
          .from(demoSchoolPurgeTable)
          .where(
            and(
              eq(demoSchoolPurgeTable.schoolId, input.schoolId),
              eq(demoSchoolPurgeTable.cleanupAttempt, input.attempt),
              inArray(demoSchoolPurgeTable.status, ['pending', 'scheduled']),
            ),
          )
          .limit(1);
        return Boolean(manifest);
      });
      if (!allowed) throw new restate.TerminalError('No pending purge manifest matches this cleanup attempt.', { errorCode: 409 });
      const handle = ctx
        .workflowSendClient(demoSchoolPurgeWorkflow, demoSchoolPurgeWorkflowKey(input.schoolId, input.attempt))
        .run(input);
      return { invocationId: await handle.invocationId };
    },
  },
});

export type DemoSchoolControlService = typeof demoSchoolControlService;
