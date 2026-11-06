import { db } from '@campuspilot/db';
import { demoSchoolJobTable, demoSchoolPurgeTable } from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { DEMO_SCHOOL_CONTROL_SERVICE_NAME, demoSchoolWorkflowKey } from './constants';
import { verifyWorkerControlCall } from '../control-auth';
import { log } from './log';
import {
  demoSchoolPurgeInputSchema,
  demoSchoolPurgeWorkflow,
  demoSchoolPurgeWorkflowKey,
  type DemoSchoolPurgeInput,
} from './purge-workflow';
import { getRestateInvocation } from './restate-admin';
import { toSafeError } from './safe-error';
import { demoSchoolWorkflow, demoSchoolWorkflowInputSchema, type DemoSchoolWorkflowInput } from './workflow';

/** Handlers of `DemoSchoolControl`; each signature is bound to one. */
export type DemoSchoolControlHandler = 'startSeed' | 'startPurge';

/** Runs a database step with a safe failure text (no SQL or parameters). */
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
 * Refuses a call that the API did not sign (see `../control-auth.ts`). Runs
 * before any journal entry and before the database is read. It is not
 * journaled: it reads only the invocation's immutable headers and Restate's
 * immutable acceptance time, so every retry reaches the same verdict. A
 * missing secret fails closed. An unreachable admin API is retried (a plain
 * error), never treated as authenticated.
 */
async function authenticate(ctx: restate.Context, handler: DemoSchoolControlHandler, input: unknown) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) {
    log.error({ handler }, 'demo-school.control.secret-missing');
    throw new restate.TerminalError('Demo control calls are disabled: WORKER_CONTROL_SECRET is not configured.', { errorCode: 503 });
  }
  const request = ctx.request();
  const invocation = await getRestateInvocation(request.id);
  if (!invocation) throw new Error('Restate does not report this invocation yet.');
  const verdict = verifyWorkerControlCall({ secret, target: { service: DEMO_SCHOOL_CONTROL_SERVICE_NAME, handler }, input, headers: request.headers, acceptedAt: invocation.createdAt });
  if (!verdict.ok) {
    log.warn({ handler, reason: verdict.reason, invocationId: request.id }, 'demo-school.control.unauthenticated');
    throw new restate.TerminalError('Unauthenticated demo control call.', { errorCode: 401 });
  }
}

/**
 * `DemoSchoolControl` is the only demo service reachable through Restate
 * ingress; both workflows are `ingressPrivate`. The API hands work to it with
 * one-way, idempotent, signed sends (so an API request never waits for a
 * worker). Every call is, in order: Zod-parsed (malformed input fails
 * terminally at once), authenticated by its HMAC signature, then checked
 * against the database, so it starts a workflow only for state the database
 * already authorises:
 * - `startSeed` runs the job's current attempt while it is queued or running
 *   and no purge was requested;
 * - `startPurge` runs the current attempt of a recorded purge request whose
 *   school is a demo school or already deleted.
 * It records the started workflow's invocation ID, which the API's outbox
 * sweep uses to notice a run that Restate paused or that ended early. The
 * workflows re-check the same facts themselves. Ingress and the admin API must
 * still never be publicly reachable (docs/demo-school.md).
 */
export const demoSchoolControlService = restate.service({
  name: DEMO_SCHOOL_CONTROL_SERVICE_NAME,
  handlers: {
    startSeed: async (ctx: restate.Context, rawInput: DemoSchoolWorkflowInput): Promise<{ invocationId: string }> => {
      const parsed = demoSchoolWorkflowInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid demo seed request.', { errorCode: 400 });
      const input = parsed.data;
      await authenticate(ctx, 'startSeed', input);
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
      const invocationId = await handle.invocationId;
      // Recorded whatever the purge state: a purge finds live runs by
      // workflow key anyway, and the sweep needs the ID to watch the run.
      await safeRun(ctx, 'record-invocation', async () => {
        await db
          .update(demoSchoolJobTable)
          .set({ invocationId })
          .where(and(eq(demoSchoolJobTable.id, input.jobId), eq(demoSchoolJobTable.attempt, input.attempt)));
      });
      return { invocationId };
    },

    startPurge: async (ctx: restate.Context, rawInput: DemoSchoolPurgeInput): Promise<{ invocationId: string }> => {
      const parsed = demoSchoolPurgeInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid demo purge request.', { errorCode: 400 });
      const input = parsed.data;
      await authenticate(ctx, 'startPurge', input);
      const allowed = await safeRun(ctx, 'validate-purge', async () => {
        const [purge] = await db
          .select({ id: demoSchoolPurgeTable.schoolId })
          .from(demoSchoolPurgeTable)
          .where(
            and(
              eq(demoSchoolPurgeTable.schoolId, input.schoolId),
              eq(demoSchoolPurgeTable.attempt, input.attempt),
              inArray(demoSchoolPurgeTable.status, ['pending', 'scheduled']),
            ),
          )
          .limit(1);
        if (!purge) return false;
        const [school] = await db.select({ isDemo: schoolTable.isDemo }).from(schoolTable).where(eq(schoolTable.id, input.schoolId)).limit(1);
        return !school || school.isDemo;
      });
      if (!allowed) throw new restate.TerminalError('No pending demo purge matches this attempt.', { errorCode: 409 });
      const handle = ctx
        .workflowSendClient(demoSchoolPurgeWorkflow, demoSchoolPurgeWorkflowKey(input.schoolId, input.attempt))
        .run(input);
      const invocationId = await handle.invocationId;
      await safeRun(ctx, 'record-invocation', async () => {
        await db
          .update(demoSchoolPurgeTable)
          .set({ invocationId })
          .where(and(eq(demoSchoolPurgeTable.schoolId, input.schoolId), eq(demoSchoolPurgeTable.attempt, input.attempt)));
      });
      return { invocationId };
    },
  },
});

export type DemoSchoolControlService = typeof demoSchoolControlService;
