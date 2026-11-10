import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { revokeCadetLoginAccess } from '@campuspilot/auth/cadet';
import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { user } from '@campuspilot/db/schema/auth';
import { cadetUser } from '@campuspilot/db/schema/cadet';
import {
  demoSchoolJobTable,
  demoSchoolPurgeTable,
  type DemoSchoolPurgeStage,
} from '@campuspilot/db/schema/demo-school-job';
import { noticeTable } from '@campuspilot/db/schema/notice';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { noticePdfKey } from '../../routers/school/notice/notice.render';
import { DEMO_SCHOOL_PURGE_WORKFLOW_NAME, demoCredentialsS3Key } from './constants';
import { log } from './log';
import { listLiveDemoSeedInvocations } from './restate-admin';
import { toSafeError } from './safe-error';

/** Workflow input; parsed before any journal entry so bad input is terminal at once. */
export const demoSchoolPurgeInputSchema = z.object({
  schoolId: z.string().regex(/^sch_[a-z0-9]{21}$/),
  attempt: z.number().int().positive().max(1_000),
});
export type DemoSchoolPurgeInput = z.infer<typeof demoSchoolPurgeInputSchema>;

/** Workflow key of one purge attempt; a key runs only once. */
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

/** The purge row's attempt is current and the purge is not finished. */
function currentAttempt(schoolId: string, attempt: number) {
  return and(
    eq(demoSchoolPurgeTable.schoolId, schoolId),
    eq(demoSchoolPurgeTable.attempt, attempt),
    inArray(demoSchoolPurgeTable.status, ['pending', 'scheduled']),
  );
}

/**
 * Loads the purge request for this attempt. Null when it is finished or a
 * later attempt replaced it, so a stale run does nothing.
 */
export async function loadDemoSchoolPurge(schoolId: string, attempt: number) {
  const [purge] = await db
    .select({ dataDeletedAt: demoSchoolPurgeTable.dataDeletedAt })
    .from(demoSchoolPurgeTable)
    .where(currentAttempt(schoolId, attempt))
    .limit(1);
  return purge ? { dataDeleted: purge.dataDeletedAt !== null } : null;
}

/** Records the stage now running; fenced by attempt like every purge write. */
export async function markDemoSchoolPurgeStage(schoolId: string, attempt: number, stage: DemoSchoolPurgeStage) {
  await db.update(demoSchoolPurgeTable).set({ stage }).where(currentAttempt(schoolId, attempt));
}

/**
 * Records purge intent on the school's jobs (idempotent; the request already
 * did it under the school lock) and returns the job IDs whose live seed runs
 * must stop. From here on every seed step refuses to run.
 */
export async function freezeDemoSchoolJobs(schoolId: string): Promise<string[]> {
  await db
    .update(demoSchoolJobTable)
    .set({ purgeRequestedAt: new Date() })
    .where(and(eq(demoSchoolJobTable.schoolId, schoolId), isNull(demoSchoolJobTable.purgeRequestedAt)));
  const jobs = await db.select({ id: demoSchoolJobTable.id }).from(demoSchoolJobTable).where(eq(demoSchoolJobTable.schoolId, schoolId));
  return jobs.map((job) => job.id);
}

/** Revokes every session (including Redis) of the given accounts. */
async function revokeSessions(userIds: string[]) {
  const authContext = await auth.$context;
  for (const userId of userIds) await authContext.internalAdapter.deleteUserSessions(userId);
}

/** The Cadet Portal logins of a school's admissions. */
async function schoolCadetLoginIds(executor: Pick<typeof db, 'select'>, schoolId: string): Promise<string[]> {
  const logins = await executor
    .select({ id: cadetUser.id })
    .from(cadetUser)
    .innerJoin(admissionTable, eq(admissionTable.id, cadetUser.admissionId))
    .where(eq(admissionTable.schoolId, schoolId));
  return logins.map((item) => item.id);
}

/**
 * Revokes the demo logins of a school whose data still exists: staff demo
 * accounts, and every Cadet Portal login of its admissions (sessions through
 * the cadet instance so Redis copies go too, plus cadet MCP grants and
 * tokens).
 */
export async function revokeDemoSchoolSessions(schoolId: string) {
  const demoUsers = await db.select({ id: user.id }).from(user).where(eq(user.demoSchoolId, schoolId));
  await revokeSessions(demoUsers.map((item) => item.id));
  await revokeCadetLoginAccess(await schoolCadetLoginIds(db, schoolId));
}

/**
 * Revokes the manifest's demo users' and cadet logins' sessions again, for
 * logins made meanwhile (their rows are gone; Redis copies may not be).
 */
export async function revokeManifestSessions(schoolId: string) {
  const [purge] = await db
    .select({ demoUserIds: demoSchoolPurgeTable.demoUserIds, cadetUserIds: demoSchoolPurgeTable.cadetUserIds })
    .from(demoSchoolPurgeTable)
    .where(eq(demoSchoolPurgeTable.schoolId, schoolId));
  await revokeSessions(purge?.demoUserIds ?? []);
  await revokeCadetLoginAccess(purge?.cadetUserIds ?? []);
}

/**
 * The data purge, in one transaction: lock the purge row and the school,
 * record the manifest of every S3 key and demo user the school owns, run
 * `purge_demo_school()` (which deletes every row the school owns, its
 * demo-only users and its admissions' Cadet Portal logins) and record
 * `data_deleted_at`. A replay after commit finds
 * `data_deleted_at` and does nothing. The requesting admin has no
 * `demo_school_id` and survives; accounts invited with a real address keep
 * their account and lose only the membership.
 */
export async function deleteDemoSchoolData(schoolId: string, attempt: number): Promise<{ deletedRows: Record<string, number>; fileCount: number }> {
  return db.transaction(async (transaction) => {
    const [purge] = await transaction
      .select({ dataDeletedAt: demoSchoolPurgeTable.dataDeletedAt })
      .from(demoSchoolPurgeTable)
      .where(currentAttempt(schoolId, attempt))
      .for('update');
    if (!purge) throw new restate.TerminalError('This purge attempt is no longer current.');
    if (purge.dataDeletedAt) return { deletedRows: {}, fileCount: 0 };
    const [school] = await transaction
      .select({ isDemo: schoolTable.isDemo, logoS3Key: schoolTable.logoS3Key })
      .from(schoolTable)
      .where(eq(schoolTable.id, schoolId))
      .for('update');
    if (!school) throw new restate.TerminalError('The school is gone but its data purge was never recorded.');
    if (!school.isDemo) throw new restate.TerminalError('Only demo schools can be purged.');
    const demoUsers = await transaction
      .select({ id: user.id, profileImageS3Key: user.profileImageS3Key })
      .from(user)
      .where(eq(user.demoSchoolId, schoolId));
    const admissions = await transaction
      .select({ photoS3Key: admissionTable.photoS3Key, documents: admissionTable.documents })
      .from(admissionTable)
      .where(eq(admissionTable.schoolId, schoolId));
    const artifacts = await transaction.select({ s3Key: artifactTable.s3Key }).from(artifactTable).where(eq(artifactTable.schoolId, schoolId));
    // A published notice's PDF is cached under a key derived from its ID
    // (no artifact row); it exists once somebody downloaded or was sent it.
    // Every possible key is recorded: deleting a missing object is harmless.
    const publishedNotices = await transaction
      .select({ id: noticeTable.id })
      .from(noticeTable)
      .where(and(eq(noticeTable.schoolId, schoolId), eq(noticeTable.status, 'published')));
    const cadetUserIds = await schoolCadetLoginIds(transaction, schoolId);
    // Recorded as-is; the file stage accepts only keys under this school's
    // or its demo users' prefixes (demoSchoolPurgeScope).
    const objectKeys = [...new Set([
      school.logoS3Key,
      demoCredentialsS3Key(schoolId),
      ...demoUsers.map((item) => item.profileImageS3Key),
      ...admissions.flatMap((item) => [item.photoS3Key, ...item.documents.flatMap((document) => document.files.map((file) => file.s3Key))]),
      ...artifacts.map((item) => item.s3Key),
      ...publishedNotices.map((item) => noticePdfKey(schoolId, item.id)),
    ].filter((key): key is string => Boolean(key)))];
    const result = await transaction.execute<{ counts: Record<string, number> }>(sql`SELECT purge_demo_school(${schoolId}) AS counts`);
    await transaction
      .update(demoSchoolPurgeTable)
      .set({ objectKeys, demoUserIds: demoUsers.map((item) => item.id), cadetUserIds, dataDeletedAt: new Date() })
      .where(eq(demoSchoolPurgeTable.schoolId, schoolId));
    return { deletedRows: result.rows[0]?.counts ?? {}, fileCount: objectKeys.length };
  });
}

/**
 * Loads the manifest of a committed data purge. Refuses while the school
 * row still exists, so nothing can be deleted for a school that was not purged.
 */
export async function loadDemoSchoolPurgeScope(schoolId: string, attempt?: number): Promise<DemoSchoolPurgeScope | null> {
  const [school] = await db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (school) throw new restate.TerminalError('The school still exists; only a committed purge can be cleaned up.');
  const [manifest] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, schoolId)).limit(1);
  if (!manifest || !manifest.dataDeletedAt || manifest.status === 'completed' || manifest.status === 'failed') return null;
  // Only the purge's current attempt may act.
  if (attempt !== undefined && manifest.attempt !== attempt) return null;
  return demoSchoolPurgeScope(manifest);
}

export async function markDemoSchoolPurgeCompleted(schoolId: string, attempt: number) {
  await db
    .update(demoSchoolPurgeTable)
    .set({ status: 'completed', stage: null, completedAt: new Date(), lastError: null })
    .where(currentAttempt(schoolId, attempt));
}

/**
 * Records a terminal failure; the stage stays where it stopped. The outbox
 * sweep retries it under the next attempt (bounded) and the admin app lists
 * it with a retry action, so it never fails silently.
 */
export async function markDemoSchoolPurgeFailed(schoolId: string, attempt: number, message: string) {
  await db
    .update(demoSchoolPurgeTable)
    .set({ status: 'failed', lastError: message })
    .where(currentAttempt(schoolId, attempt));
  log.error({ schoolId, attempt, message }, 'demo-school.purge.failed');
}

/** Runs one named, idempotent unit of work; Restate journals it, tests call it directly. */
export type DemoPurgeStepRunner = <T>(name: string, action: () => Promise<T>) => Promise<T>;

/**
 * The ordered purge, shared by the workflow and the integration tests.
 * `stopSeedRuns` cancels the given live seed runs and resolves once all of
 * them have ended (durably in the workflow). Every stage is idempotent, so a
 * retry under a new attempt resumes: once the data is deleted, only the
 * session revoke and the file stage run again.
 */
export async function runDemoSchoolPurgeStages(options: {
  schoolId: string;
  attempt: number;
  step: DemoPurgeStepRunner;
  stopSeedRuns: (invocationIds: string[]) => Promise<void>;
}): Promise<{ status: 'completed' | 'refused'; deleted: number }> {
  const { schoolId, attempt, step } = options;
  const stage = (name: DemoSchoolPurgeStage) => step(`stage:${name}`, () => markDemoSchoolPurgeStage(schoolId, attempt, name));
  const purge = await step('load-purge', () => loadDemoSchoolPurge(schoolId, attempt));
  if (!purge) return { status: 'refused', deleted: 0 };

  if (!purge.dataDeleted) {
    await stage('stopping-seed');
    const jobIds = await step('freeze-jobs', () => freezeDemoSchoolJobs(schoolId));
    const live = await step('find-seed-runs', () => listLiveDemoSeedInvocations(jobIds));
    await options.stopSeedRuns(live);

    await stage('revoking-sessions');
    await step('revoke-sessions', () => revokeDemoSchoolSessions(schoolId));

    await stage('deleting-data');
    const deleted = await step('delete-data', () => deleteDemoSchoolData(schoolId, attempt));
    log.info({ schoolId, attempt, ...deleted }, 'demo-school.purge.data.ok');
  }
  await step('revoke-manifest-sessions', () => revokeManifestSessions(schoolId));

  await stage('deleting-files');
  const scope = await step('load-manifest', () => loadDemoSchoolPurgeScope(schoolId, attempt));
  if (!scope) return { status: 'refused', deleted: 0 };
  const keys = await step('collect-keys', () => collectDemoSchoolObjectKeys(scope));
  for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
    const batch = keys.slice(offset, offset + DELETE_BATCH_SIZE);
    await step(`delete:${offset}`, () => deleteDemoSchoolObjectBatch(batch));
  }
  await step('complete', async () => {
    await markDemoSchoolPurgeCompleted(schoolId, attempt);
    log.info({ schoolId, s3Objects: keys.length }, 'demo-school.purge.ok');
  });
  return { status: 'completed', deleted: keys.length };
}

const STEP_OPTIONS = { maxRetryAttempts: 8, initialRetryInterval: 1_000, retryIntervalFactor: 2, maxRetryInterval: 60_000 } as const;

/**
 * `DemoSchoolPurge` purges one demo school: stop its seed runs, revoke demo
 * sessions, delete its data in one transaction, revoke again, delete its S3
 * objects. Keyed `{schoolId}.{attempt}`; it takes only IDs and reads
 * everything else from `demo_school_purge`, never from its caller. Private
 * to ingress; `DemoSchoolControl` starts it.
 *
 * Running seed runs are cancelled with `ctx.invocation(id).cancel()` and
 * awaited with `attach()`: a durable wait with no timeout, so a seed step
 * that is still writing finishes (or fails) before the data purge starts,
 * however long it takes, and a worker restart resumes the wait. Seed runs
 * started after the purge intent refuse at their first step.
 */
export const demoSchoolPurgeWorkflow = restate.workflow({
  name: DEMO_SCHOOL_PURGE_WORKFLOW_NAME,
  options: { ingressPrivate: true },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: DemoSchoolPurgeInput): Promise<{ status: 'completed' | 'refused'; deleted: number }> => {
      const parsed = demoSchoolPurgeInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid demo purge input.', { errorCode: 400 });
      const { schoolId, attempt } = parsed.data;
      if (ctx.key !== demoSchoolPurgeWorkflowKey(schoolId, attempt)) {
        throw new restate.TerminalError('The workflow key does not match the purge attempt.');
      }
      try {
        return await runDemoSchoolPurgeStages({
          schoolId,
          attempt,
          step: (name, action) =>
            ctx.run(name, async () => {
              try {
                return await action();
              } catch (error) {
                throw toSafeError(error, { workflow: DEMO_SCHOOL_PURGE_WORKFLOW_NAME, key: ctx.key, step: name });
              }
            }, STEP_OPTIONS),
          stopSeedRuns: async (invocationIds) => {
            for (const id of invocationIds) ctx.invocation(restate.InvocationIdParser.fromString(id)).cancel();
            for (const id of invocationIds) {
              try {
                await ctx.invocation(restate.InvocationIdParser.fromString(id)).attach();
              } catch (error) {
                // A cancelled or failed seed run ending is exactly what we wait for.
                if (!(error instanceof restate.TerminalError)) throw error;
              }
            }
          },
        });
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
