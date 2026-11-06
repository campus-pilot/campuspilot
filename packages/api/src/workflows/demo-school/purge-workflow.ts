import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import * as restate from '@restatedev/restate-sdk';

import { DEMO_SCHOOL_PURGE_WORKFLOW_NAME } from './constants';
import { log } from './log';

export type DemoSchoolPurgeInput = {
  schoolId: string;
  /** Object keys recorded in the database before the purge committed. */
  keys: string[];
  /** Prefixes listed again here to catch orphans (`schools/{id}/`, `users/{id}/`). */
  prefixes: string[];
};

const DELETE_BATCH_SIZE = 500;

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

/** Every key to delete: the recorded keys plus whatever the prefixes still hold. */
export async function collectDemoSchoolObjectKeys(input: DemoSchoolPurgeInput): Promise<string[]> {
  const listed = await Promise.all(input.prefixes.map(listPrefix));
  return [...new Set([...input.keys, ...listed.flat()])].sort();
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
 * `DemoSchoolPurge` removes a purged demo school's S3 objects after the
 * database purge has committed (plan §9.2 step 4). Keyed by school ID. The
 * key list is journaled once, then deleted in batches; a failed batch is
 * retried by Restate instead of leaking objects. Deleting a missing key is a
 * no-op, so replays are safe.
 */
export const demoSchoolPurgeWorkflow = restate.workflow({
  name: DEMO_SCHOOL_PURGE_WORKFLOW_NAME,
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: DemoSchoolPurgeInput): Promise<{ deleted: number }> => {
      const keys = await ctx.run('collect-keys', () => collectDemoSchoolObjectKeys(input));
      for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
        const batch = keys.slice(offset, offset + DELETE_BATCH_SIZE);
        await ctx.run(`delete:${offset}`, () => deleteDemoSchoolObjectBatch(batch), { initialRetryInterval: 1_000, maxRetryInterval: 60_000 });
      }
      await ctx.run('log', async () => {
        log.info({ schoolId: input.schoolId, s3Objects: keys.length }, 'demo-school.purge.s3.ok');
      });
      return { deleted: keys.length };
    },
  },
});

export type DemoSchoolPurgeWorkflow = typeof demoSchoolPurgeWorkflow;
