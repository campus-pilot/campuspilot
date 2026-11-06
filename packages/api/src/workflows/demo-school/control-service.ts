import { db } from '@campuspilot/db';
import { demoSchoolJobTable, demoSchoolPurgeTable } from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray } from 'drizzle-orm';

import { DEMO_SCHOOL_CONTROL_SERVICE_NAME, demoSchoolWorkflowKey } from './constants';
import { demoSchoolPurgeWorkflow } from './purge-workflow';
import { demoSchoolWorkflow } from './workflow';

/**
 * `DemoSchoolControl` is the only demo service reachable through Restate
 * ingress; both workflows are `ingressPrivate`. The API calls it through the
 * ingress client (Restate OSS cannot authenticate ingress callers, so the
 * workflows cannot be reached by any other path the API could use). It takes
 * only IDs and starts a workflow only for state the database already
 * authorises, so a caller reaching ingress can do no more than the API would:
 * - `startSeed` runs the job's current attempt while it is queued or running;
 * - `startPurgeCleanup` runs S3 cleanup only for a committed purge manifest of
 *   a school that no longer exists.
 * The workflows re-check the same facts themselves. Ingress and the admin API
 * must still never be publicly reachable (docs/demo-school.md).
 */
export const demoSchoolControlService = restate.service({
  name: DEMO_SCHOOL_CONTROL_SERVICE_NAME,
  handlers: {
    startSeed: async (ctx: restate.Context, input: { jobId: string; attempt: number }): Promise<{ invocationId: string }> => {
      const allowed = await ctx.run('validate-job', async () => {
        const [job] = await db
          .select({ id: demoSchoolJobTable.id })
          .from(demoSchoolJobTable)
          .where(
            and(
              eq(demoSchoolJobTable.id, input.jobId),
              eq(demoSchoolJobTable.attempt, input.attempt),
              inArray(demoSchoolJobTable.status, ['queued', 'running']),
            ),
          )
          .limit(1);
        return Boolean(job);
      });
      if (!allowed) throw new restate.TerminalError('No queued or running demo job matches this attempt.', { errorCode: 409 });
      const handle = ctx
        .workflowSendClient(demoSchoolWorkflow, demoSchoolWorkflowKey(input.jobId, input.attempt))
        .run({ jobId: input.jobId, attempt: input.attempt });
      return { invocationId: await handle.invocationId };
    },

    startPurgeCleanup: async (ctx: restate.Context, input: { schoolId: string }): Promise<{ invocationId: string }> => {
      const allowed = await ctx.run('validate-manifest', async () => {
        const [school] = await db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, input.schoolId)).limit(1);
        if (school) return false;
        const [manifest] = await db
          .select({ status: demoSchoolPurgeTable.status })
          .from(demoSchoolPurgeTable)
          .where(eq(demoSchoolPurgeTable.schoolId, input.schoolId))
          .limit(1);
        return manifest !== undefined && manifest.status !== 'completed';
      });
      if (!allowed) throw new restate.TerminalError('No pending purge manifest exists for this school.', { errorCode: 409 });
      const handle = ctx.workflowSendClient(demoSchoolPurgeWorkflow, input.schoolId).run({ schoolId: input.schoolId });
      return { invocationId: await handle.invocationId };
    },
  },
});

export type DemoSchoolControlService = typeof demoSchoolControlService;
