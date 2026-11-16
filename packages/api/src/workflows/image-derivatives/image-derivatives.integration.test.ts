import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { assistantAttachmentTable } from '@campuspilot/db/schema/assistant';
import { examQuestionPaperPageTable } from '@campuspilot/db/schema/exam-question-paper';
import { generateId } from '@campuspilot/db/id';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../test/question-paper';
import { putObject, questionPaperKeys } from '../../routers/school/question-paper/question-paper.storage';
import { IMAGE_DERIVATIVE_DEADLINE_MS, IMAGE_DERIVATIVE_RESEND_AFTER_MS } from './constants';
import { assistantAttachmentKeys } from './keys';
import { sweepImageDerivatives } from './outbox';
import { processAttachmentDerivatives, processPageDerivatives } from './process';
import { sendImageDerivativeJob } from './restate';

/** The send to Restate is recorded, not made: these tests are about what is sent and when. */
vi.mock('./restate', () => ({ sendImageDerivativeJob: vi.fn(async () => ({ invocationId: 'inv_test' })) }));

async function exists(key: string) {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

describe('image derivatives', () => {
  let world: QuestionPaperWorld;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
  });
  beforeEach(() => vi.mocked(sendImageDerivativeJob).mockClear());

  /** A stored, pending page with its original in storage, as the upload route leaves it. */
  async function storedPage(options: { bytes: Buffer; storedAt?: Date; key?: object }) {
    const { pages } = await world.people.manager.client.school.reserveQuestionPaperPages({ ...world.key(options.key ?? {}), fileNames: ['photo.jpg'] });
    const page = pages[0]!;
    const originalS3Key = questionPaperKeys.original(world.schoolId, page.id, 'jpg', 'test');
    await putObject(originalS3Key, options.bytes, 'image/jpeg');
    await db
      .update(examQuestionPaperPageTable)
      .set({ uploadStatus: 'stored', originalS3Key, contentType: 'image/jpeg', byteSize: options.bytes.byteLength, sha256: 'x', storedAt: options.storedAt ?? new Date() })
      .where(eq(examQuestionPaperPageTable.id, page.id));
    return page.id;
  }
  const pageRow = async (id: string) => (await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.id, id)))[0];
  const photo = () => sharp({ create: { width: 2400, height: 3200, channels: 3, background: '#eee' } }).jpeg({ quality: 90 }).toBuffer();

  it('makes a page thumbnail and model copy in the worker and records them, once', async () => {
    const id = await storedPage({ bytes: await photo() });
    expect(await processPageDerivatives(db, id)).toBe('ready');
    const row = (await pageRow(id))!;
    expect(row).toMatchObject({ derivativeStatus: 'ready', width: 2400, height: 3200, modelContentType: 'image/jpeg' });
    for (const key of [row.thumbS3Key!, row.modelS3Key!]) expect(await exists(key), key).toBe(true);
    expect(row.modelByteSize!).toBeLessThanOrEqual(600 * 1024);
    // A second delivery of the same job (a Restate retry, the sweep) changes nothing.
    expect(await processPageDerivatives(db, id)).toBe('skipped');
  });

  it('keeps the copies an overlapping run recorded when its own fenced update misses', async () => {
    const id = await storedPage({ bytes: await photo(), key: { classId: world.otherClassId } });
    // Two runs on one page at once (a replayed demo seed beside the sweep's job): both read it pending and write the same keys.
    const outcomes = await Promise.all([processPageDerivatives(db, id), processPageDerivatives(db, id)]);
    expect(outcomes.toSorted()).toEqual(['ready', 'skipped']);
    const row = (await pageRow(id))!;
    expect(row).toMatchObject({ derivativeStatus: 'ready' });
    for (const key of [row.thumbS3Key!, row.modelS3Key!]) expect(await exists(key), key).toBe(true);
  });

  it('marks a photo that cannot be decoded failed instead of retrying it', async () => {
    const id = await storedPage({ bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)]), key: { subjectSlug: 'math' } });
    expect(await processPageDerivatives(db, id)).toBe('failed');
    expect(await pageRow(id)).toMatchObject({ derivativeStatus: 'failed', thumbS3Key: null, modelS3Key: null });
  });

  it('keeps nothing for a page that stopped being pending while it was processed', async () => {
    const id = await storedPage({ bytes: await photo(), key: { subjectSlug: 'math', modeSlug: 'practical' } });
    // The sweep's deadline passed first: the late result must not resurrect the page, nor leave objects behind.
    await db.update(examQuestionPaperPageTable).set({ derivativeStatus: 'failed' }).where(eq(examQuestionPaperPageTable.id, id));
    expect(await processPageDerivatives(db, id)).toBe('skipped');
    expect(await exists(questionPaperKeys.thumb(world.schoolId, id))).toBe(false);
  });

  it('makes a chat image copy and fences on pending the same way', async () => {
    const id = generateId('assistantAttachment');
    const bytes = await photo();
    const s3Key = assistantAttachmentKeys.original(world.schoolId, id, 'jpg');
    await putObject(s3Key, bytes, 'image/jpeg');
    await db.insert(assistantAttachmentTable).values({
      id,
      schoolId: world.schoolId,
      userId: world.people.manager.userId,
      kind: 'image',
      originalName: 'board.jpg',
      contentType: 'image/jpeg',
      byteSize: bytes.byteLength,
      sha256: 'x',
      s3Key,
      derivativeStatus: 'pending',
    });
    expect(await processAttachmentDerivatives(db, id)).toBe('ready');
    const [row] = await db.select().from(assistantAttachmentTable).where(eq(assistantAttachmentTable.id, id));
    expect(row).toMatchObject({ derivativeStatus: 'ready', thumbS3Key: assistantAttachmentKeys.thumb(world.schoolId, id), modelS3Key: assistantAttachmentKeys.model(world.schoolId, id) });
    expect(await exists(row!.modelS3Key!)).toBe(true);
    expect(await processAttachmentDerivatives(db, id)).toBe('skipped');
  });

  it('sends a pending image again after a while, fails one past the deadline, and leaves a fresh one to its first hand-over', async () => {
    const now = Date.now();
    const other = { classId: world.otherClassId };
    const fresh = await storedPage({ bytes: await photo(), key: { ...other, subjectSlug: 'science' } });
    const waiting = await storedPage({ bytes: await photo(), storedAt: new Date(now - IMAGE_DERIVATIVE_RESEND_AFTER_MS - 5_000), key: { ...other, subjectSlug: 'math' } });
    const late = await storedPage({ bytes: await photo(), storedAt: new Date(now - IMAGE_DERIVATIVE_DEADLINE_MS - 5_000), key: { ...other, subjectSlug: 'math', modeSlug: 'practical' } });

    const result = await sweepImageDerivatives(db, new Date(now));
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await pageRow(late)).toMatchObject({ derivativeStatus: 'failed' });
    const sent = vi.mocked(sendImageDerivativeJob).mock.calls.map(([input]) => input);
    expect(sent).toContainEqual({ target: 'page', id: waiting });
    expect(sent).not.toContainEqual({ target: 'page', id: fresh });
    expect(sent).not.toContainEqual({ target: 'page', id: late });
    expect(await pageRow(waiting)).toMatchObject({ derivativeStatus: 'pending' });
  });
});
