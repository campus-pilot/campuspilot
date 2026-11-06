import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { demoSchoolPurgeTable } from '@campuspilot/db/schema/demo-school-job';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { DEMO_SCHOOL_PURGE_WORKFLOW_NAME } from './constants';
import { log } from './log';
import { toSafeError } from './safe-error';

/** Workflow input; parsed before any journal entry so bad input is terminal at once. */
export const demoSchoolPurgeInputSchema = z.object({
  schoolId: z.string().regex(/^sch_[a-z0-9]{21}$/),
  attempt: z.number().int().positive().max(1_000),
});
export type DemoSchoolPurgeInput = z.infer<typeof demoSchoolPurgeInputSchema>;

/** Workflow key of one cleanup attempt; a key runs only once. */
export function demoSchoolPurgeWorkflowKey(schoolId: string, attempt: number) {
  return `${schoolId}.${attempt}`;
}

/** What a purge may delete: the manifest's keys and prefixes, already filtered. */
export type DemoSchoolPurgeScope = { keys: string[]; prefixes: string[] };

const DELETE_BATCH_SIZE = 500;
/** Entity IDs are prefix + 21 lowercase alphanumerics; user IDs are Better Auth IDs. */
const SCHOOL_ID_PATTERN = /^sch_[a-z0-9]{21}$/;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Builds the deletion scope from a purge manifest. Only keys under the
 * school's own `schools/{schoolId}/` prefix or a recorded demo user's
 * `users/{userId}/` prefix are accepted; anything else in the manifest (for
 * example a logo key pointing into another school) is dropped. Malformed IDs
 * are refused, so a prefix can never be empty, the bucket root, or another
 * tenant's.
 */
export function demoSchoolPurgeScope(manifest: { schoolId: string; objectKeys: string[]; demoUserIds: string[] }): DemoSchoolPurgeScope {
  if (!SCHOOL_ID_PATTERN.test(manifest.schoolId)) throw new restate.TerminalError('Invalid school ID in purge manifest.');
  for (const userId of manifest.demoUserIds) {
    if (!USER_ID_PATTERN.test(userId)) throw new restate.TerminalError('Invalid user ID in purge manifest.');
  }
  const prefixes = [`schools/${manifest.schoolId}/`, ...manifest.demoUserIds.map((userId) => `users/${userId}/`)];
  const keys = manifest.objectKeys.filter(
    (key) => !key.includes('..') && prefixes.some((prefix) => key.startsWith(prefix) && key.length > prefix.length),
  );
  return { keys: [...new Set(keys)].sort(), prefixes };
}

async function listPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await getS3Client().send(
      new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

/** Every key to delete: the scoped manifest keys plus whatever the prefixes still hold. */
export async function collectDemoSchoolObjectKeys(scope: DemoSchoolPurgeScope): Promise<string[]> {
  const listed = await Promise.all(scope.prefixes.map(listPrefix));
  return [...new Set([...scope.keys, ...listed.flat()])].sort();
}

/** Deletes one batch (at most 1,000 keys, the S3 limit); missing keys are fine. */
export async function deleteDemoSchoolObjectBatch(keys: string[]) {
  const result = await getS3Client().send(
    new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
  );
  const failed = (result.Errors ?? []).filter((item) => item.Code !== 'NoSuchKey');
  if (failed.length > 0) throw new Error(`S3 refused to delete ${failed.length} demo objects.`);
}

/**
 * Loads the manifest of a committed purge. Refuses while the school row
 * still exists, so nothing can be deleted for a school that was not purged.
 */
export async function loadDemoSchoolPurgeScope(schoolId: string, attempt?: number): Promise<DemoSchoolPurgeScope | null> {
  const [school] = await db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (school) throw new restate.TerminalError('The school still exists; only a committed purge can be cleaned up.');
  const [manifest] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, schoolId)).limit(1);
  if (!manifest || manifest.status === 'completed' || manifest.status === 'failed') return null;
  // Only the manifest's current cleanup attempt may act.
  if (attempt !== undefined && manifest.cleanupAttempt !== attempt) return null;
  return demoSchoolPurgeScope(manifest);
}

/**
 * Records a terminal cleanup failure so the outbox sweep retries it under the
 * next attempt (bounded), instead of the objects leaking silently.
 */
async function markDemoSchoolPurgeFailed(schoolId: string, attempt: number, message: string) {
  await db
    .update(demoSchoolPurgeTable)
    .set({ status: 'failed', lastError: message })
    .where(and(eq(demoSchoolPurgeTable.schoolId, schoolId), eq(demoSchoolPurgeTable.cleanupAttempt, attempt), inArray(demoSchoolPurgeTable.status, ['pending', 'scheduled'])));
  log.error({ schoolId, attempt, message }, 'demo-school.purge.s3.failed');
}

function safeRun<T>(ctx: restate.WorkflowContext, name: string, action: () => Promise<T>, options?: restate.RunOptions<T>) {
  return ctx.run(name, async () => {
    try {
      return await action();
    } catch (error) {
      throw toSafeError(error, { workflow: DEMO_SCHOOL_PURGE_WORKFLOW_NAME, key: ctx.key, step: name });
    }
  }, options ?? {});
}

/**
 * `DemoSchoolPurge` removes a purged demo school's S3 objects after the
 * database purge committed (plan §9.2 step 4). It takes only the school ID and
 * cleanup attempt, keyed `{schoolId}.{attempt}`, and reads what to delete from
 * `demo_school_purge`, never from its caller. Private to ingress;
 * `DemoSchoolControl` starts it. No timed wait is needed before listing: the
 * purge waited for cancelled seed runs, and any upload that still lands later
 * is deleted by its own step (`assertUploadsKept`). A terminal failure marks
 * the manifest `failed`, which the outbox sweep retries.
 */
export const demoSchoolPurgeWorkflow = restate.workflow({
  name: DEMO_SCHOOL_PURGE_WORKFLOW_NAME,
  options: { ingressPrivate: true },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: DemoSchoolPurgeInput): Promise<{ deleted: number }> => {
      const parsed = demoSchoolPurgeInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid purge cleanup input.', { errorCode: 400 });
      const { schoolId, attempt } = parsed.data;
      if (ctx.key !== demoSchoolPurgeWorkflowKey(schoolId, attempt)) {
        throw new restate.TerminalError('The workflow key does not match the cleanup attempt.');
      }
      try {
        const scope = await safeRun(ctx, 'load-manifest', () => loadDemoSchoolPurgeScope(schoolId, attempt));
        if (!scope) return { deleted: 0 };
        const keys = await safeRun(ctx, 'collect-keys', () => collectDemoSchoolObjectKeys(scope));
        for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
          const batch = keys.slice(offset, offset + DELETE_BATCH_SIZE);
          await safeRun(ctx, `delete:${offset}`, () => deleteDemoSchoolObjectBatch(batch), { initialRetryInterval: 1_000, maxRetryInterval: 60_000 });
        }
        await safeRun(ctx, 'complete', async () => {
          await db
            .update(demoSchoolPurgeTable)
            .set({ status: 'completed', completedAt: new Date(), lastError: null })
            .where(and(eq(demoSchoolPurgeTable.schoolId, schoolId), eq(demoSchoolPurgeTable.cleanupAttempt, attempt)));
          log.info({ schoolId, s3Objects: keys.length }, 'demo-school.purge.s3.ok');
        });
        return { deleted: keys.length };
      } catch (error) {
        if (error instanceof restate.TerminalError) {
          const message = error.message.slice(0, 300);
          await ctx.run('mark-failed', () => markDemoSchoolPurgeFailed(schoolId, attempt, message));
        }
        throw error;
      }
    },
  },
});

export type DemoSchoolPurgeWorkflow = typeof demoSchoolPurgeWorkflow;
