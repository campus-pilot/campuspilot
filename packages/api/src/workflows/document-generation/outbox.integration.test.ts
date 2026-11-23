import { PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { documentGenerationJobTable } from '@campuspilot/db/schema/document-generation-job';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSchoolStaffSession, createTestClient, createTestSchool, createTestSession } from '../../../test/fixtures';
import {
  DOCUMENT_GENERATION_CLEANUP_GRACE_MS,
  DOCUMENT_GENERATION_HANDOVER_DEADLINE_MS,
  DOCUMENT_GENERATION_RUN_DEADLINE_MS,
  DOCUMENT_GENERATION_START_DEADLINE_MS,
} from './constants';
import { dispatchDocumentGenerationJob, sweepDocumentGenerationOutbox } from './outbox';
import { documentJobPrefix } from './storage';

/**
 * Restate is replaced by a controllable fake. Jobs of other test files that
 * share this database (a sweep sees every school's rows) always fail to hand
 * over here, with the error an unsigned deployment gives, so this file never
 * marks another file's job as handed over.
 */
const restate = vi.hoisted(() => ({ mine: new Set<string>(), fail: false, sent: [] as string[] }));
vi.mock('./restate', () => ({
  sendDocumentGenerationStart: vi.fn(async (jobId: string) => {
    if (!restate.mine.has(jobId)) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
    if (restate.fail) throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
    restate.sent.push(jobId);
    return { invocationId: `inv_${jobId}` };
  }),
}));

const ago = (ms: number) => new Date(Date.now() - ms);

describe('document generation outbox', () => {
  let schoolId: string;
  let sessionId: string;
  let templateRevisionId: string;
  beforeAll(async () => {
    schoolId = (await createTestSchool()).id;
    sessionId = (await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
    const manager = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'manager' }])).session);
    templateRevisionId = (await manager.school.selectMarketplaceTemplate({ schoolId, documentType: 'id_card', slug: 'id_card-default', expectedRevisionId: null })).revisionId;
  });
  beforeEach(() => {
    restate.fail = false;
    restate.sent.length = 0;
  });

  async function job(values: Partial<typeof documentGenerationJobTable.$inferInsert>) {
    const [row] = await db
      .insert(documentGenerationJobTable)
      .values({
        schoolId,
        sessionId,
        documentType: 'id_card',
        requestedBy: 'user',
        source: { documentType: 'id_card', sessionId, classId: 'cls' },
        templateRevisionId,
        artifactId: `art_${crypto.randomUUID().replaceAll('-', '').slice(0, 21)}`,
        name: 'Student IDs',
        documentCount: 1,
        generatedAt: new Date(),
        ...values,
      })
      .returning();
    restate.mine.add(row!.id);
    return row!;
  }
  const reload = async (id: string) => (await db.select().from(documentGenerationJobTable).where(eq(documentGenerationJobTable.id, id)))[0]!;

  it('hands a queued job over once and never sends it again', async () => {
    const queued = await job({});
    expect(await dispatchDocumentGenerationJob(db, queued.id)).toBe(true);
    expect(restate.sent).toEqual([queued.id]);
    expect(await reload(queued.id)).toMatchObject({ status: 'queued', handoverAttempts: 1, lastHandoverError: null, handedOverAt: expect.any(Date) });
    expect(await dispatchDocumentGenerationJob(db, queued.id)).toBe(false);
    await sweepDocumentGenerationOutbox(db);
    expect(restate.sent).toEqual([queued.id]);
  });

  it('keeps retrying a hand-over Restate refused, and fails it visibly after the deadline', async () => {
    const queued = await job({});
    const stuck = await job({ createdAt: ago(DOCUMENT_GENERATION_HANDOVER_DEADLINE_MS + 60_000) });
    restate.fail = true;
    await sweepDocumentGenerationOutbox(db);
    expect(await reload(queued.id)).toMatchObject({ status: 'queued', handedOverAt: null, lastHandoverError: 'Restate is unreachable.' });
    expect(await reload(stuck.id)).toMatchObject({ status: 'failed', errorCode: 'dispatch_failed', errorMessage: 'The PDF could not be started. Try again.' });
    restate.fail = false;
    await sweepDocumentGenerationOutbox(db);
    expect(await reload(queued.id)).toMatchObject({ status: 'queued', handedOverAt: expect.any(Date) });
  });

  it('fails jobs that never started or ran too long, and leaves the others alone', async () => {
    const late = await job({ handedOverAt: ago(DOCUMENT_GENERATION_START_DEADLINE_MS + 60_000), handoverAttempts: 1 });
    const waiting = await job({ handedOverAt: ago(60_000), handoverAttempts: 1 });
    const hung = await job({ status: 'running', handedOverAt: ago(DOCUMENT_GENERATION_RUN_DEADLINE_MS + 120_000), startedAt: ago(DOCUMENT_GENERATION_RUN_DEADLINE_MS + 60_000) });
    await sweepDocumentGenerationOutbox(db);
    expect(await reload(late.id)).toMatchObject({ status: 'failed', errorCode: 'not_started' });
    expect(await reload(waiting.id)).toMatchObject({ status: 'queued' });
    expect(await reload(hung.id)).toMatchObject({ status: 'failed', errorCode: 'not_finished' });
  });

  it('allows one running job per school', async () => {
    const running = await job({ status: 'running', startedAt: new Date() });
    await expect(job({ status: 'running', startedAt: new Date() })).rejects.toThrow();
    await db.update(documentGenerationJobTable).set({ status: 'failed', errorCode: 'internal_error', completedAt: new Date() }).where(eq(documentGenerationJobTable.id, running.id));
  });

  it('removes the temporary objects an ended job left behind (the worker died, or the sweep failed it)', async () => {
    const ended = await job({ status: 'failed', errorCode: 'not_finished', errorMessage: 'x', startedAt: ago(DOCUMENT_GENERATION_CLEANUP_GRACE_MS * 3), completedAt: ago(DOCUMENT_GENERATION_CLEANUP_GRACE_MS * 2) });
    const prefix = documentJobPrefix(schoolId, ended.id);
    await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: `${prefix}batch-0001.json`, Body: '{}', ContentType: 'application/json' }));
    await sweepDocumentGenerationOutbox(db);
    const listed = await getS3Client().send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix }));
    expect(listed.Contents ?? []).toEqual([]);
    expect(await reload(ended.id)).toMatchObject({ temporaryObjectsDeletedAt: expect.any(Date) });
  });
});
