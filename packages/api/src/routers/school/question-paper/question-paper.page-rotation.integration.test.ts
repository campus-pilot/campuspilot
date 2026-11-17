import { readFileSync } from 'node:fs';

import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { examQuestionPaperJobTable, examQuestionPaperPageTable } from '@campuspilot/db/schema/exam-question-paper';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../../test/question-paper';
import { configureQuestionPaperModel, type QuestionPaperModel } from '../../../workflows/question-paper/model';
import { handleQuestionPaperPageRead, handleQuestionPaperPageUpload } from './question-paper.http';
import { resolvePaperScope } from './question-paper.scope';
import { startQuestionPaperGeneration } from './question-paper.service';

/** No job here is handed to a workflow engine (see the pages integration test). */
vi.mock('../../../workflows/question-paper/restate', () => ({
  sendQuestionPaperStart: vi.fn(async () => {
    throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  }),
}));

const HEVC_STILL = readFileSync(new URL('../../../files/__fixtures__/hevc-still.heic', import.meta.url));

/** A landscape page (as a sideways phone photo displays after EXIF orientation). */
const landscape = () => sharp({ create: { width: 800, height: 600, channels: 3, background: '#ddd' } }).jpeg().toBuffer();

function uploadRequest(bytes: Uint8Array, type: string, filename: string) {
  const formData = new FormData();
  formData.set('page', new Blob([Uint8Array.from(bytes)], { type }), filename);
  return new Request('http://localhost/upload', { method: 'POST', body: formData });
}

async function exists(key: string) {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function storedKeys(prefix: string) {
  const result = await getS3Client().send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix }));
  return (result.Contents ?? []).map((object) => object.Key!).sort();
}

const fakeModel: QuestionPaperModel = {
  provider: 'gemini',
  model: 'fake-model',
  prices: { inputUsdPerMtok: '1', outputUsdPerMtok: '1', cacheReadUsdPerMtok: '0', cacheWriteUsdPerMtok: '0' },
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  generate: async () => {
    throw new Error('Not used by the API.');
  },
  failureKind: () => 'unknown',
  billedUsageOf: () => null,
};

/** The size of the image a page read route redirects to. */
async function servedSize(response: Response) {
  expect(response.status).toBe(302);
  const image = await fetch(response.headers.get('location')!);
  const { width, height, format } = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
  return { width, height, format };
}

describe('turning a question paper page', () => {
  let world: QuestionPaperWorld;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
  });
  afterEach(() => configureQuestionPaperModel(undefined));

  const key = (overrides = {}) => world.key(overrides);
  const upload = async (bytes: Uint8Array, type: string, filename: string, overrides = {}) => {
    const response = await handleQuestionPaperPageUpload(uploadRequest(bytes, type, filename), world.people.manager.context, key(overrides));
    expect(response.status).toBe(200);
    return (await response.json()) as { page: { id: string }; pageRevision: number };
  };
  const row = async (pageId: string) => (await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.id, pageId)))[0]!;
  const read = (pageId: string, variant: string, overrides = {}) =>
    handleQuestionPaperPageRead(world.people.teacher.context, key(overrides), { pageId, variant });
  const pagePrefix = (pageId: string) => `schools/${world.schoolId}/exam-question-papers/pages/${pageId}/`;
  /** A page of its own on the default paper, so no test depends on what another one uploaded or turned. */
  const ownPage = async () => {
    const { page } = await upload(await landscape(), 'image/jpeg', 'page.jpg');
    const { paper, pages } = await world.people.manager.client.school.getQuestionPaperDetail(key());
    return { paper, page: pages.find((candidate) => candidate.id === page.id)! };
  };

  it('stores the turn, makes both derivatives again from the untouched original with the sides swapped, and bumps the revision', async () => {
    const { page, pageRevision } = await upload(await landscape(), 'image/jpeg', 'sideways.jpg');
    const before = await row(page.id);
    expect(before).toMatchObject({ rotation: 0, derivativeRevision: 0, width: 800, height: 600 });
    expect(await servedSize(await read(page.id, 'model'))).toEqual({ width: 800, height: 600, format: 'jpeg' });

    const turned = await world.people.teacher.client.school.rotateQuestionPaperPage({ ...key(), pageId: page.id, rotation: 90, expectedPageRevision: pageRevision });
    expect(turned.pageRevision).toBe(pageRevision + 1);
    expect(turned.page).toMatchObject({ id: page.id, rotation: 90, derivativeRevision: 1, width: 600, height: 800, derivativeStatus: 'ready' });

    const after = await row(page.id);
    // The original is the upload, unchanged; the derivatives are new objects and the old ones are gone.
    expect(after).toMatchObject({ originalS3Key: before.originalS3Key, sha256: before.sha256, byteSize: before.byteSize, rotation: 90, width: 600, height: 800 });
    expect(after.thumbS3Key).not.toBe(before.thumbS3Key);
    expect(after.modelS3Key).not.toBe(before.modelS3Key);
    expect(after.modelByteSize).toBeGreaterThan(0);
    expect(await storedKeys(pagePrefix(page.id))).toEqual([after.originalS3Key, after.modelS3Key!, after.thumbS3Key!].sort());
    for (const gone of [before.thumbS3Key!, before.modelS3Key!]) expect(await exists(gone), gone).toBe(false);
    expect(await servedSize(await read(page.id, 'model'))).toEqual({ width: 600, height: 800, format: 'jpeg' });
    expect(await servedSize(await read(page.id, 'thumb'))).toEqual({ width: 270, height: 360, format: 'jpeg' });
    expect((await sharp(await (await fetch((await read(page.id, 'original')).headers.get('location')!)).arrayBuffer()).metadata()).width).toBe(800);

    const detail = await world.people.manager.client.school.getQuestionPaperDetail(key());
    expect(detail.paper.pageRevision).toBe(turned.pageRevision);
    expect(detail.pages.find((candidate) => candidate.id === page.id)).toMatchObject({ rotation: 90, derivativeRevision: 1, width: 600, height: 800 });

    // Turning back makes new objects again (a cached URL of the first turn is never reused) and restores the size.
    const back = await world.people.manager.client.school.rotateQuestionPaperPage({ ...key(), pageId: page.id, rotation: 0, expectedPageRevision: turned.pageRevision });
    expect(back).toMatchObject({ pageRevision: turned.pageRevision + 1, page: { rotation: 0, derivativeRevision: 2, width: 800, height: 600 } });
    const restored = await row(page.id);
    expect([restored.thumbS3Key, restored.modelS3Key]).not.toContain(before.thumbS3Key);
    expect(await storedKeys(pagePrefix(page.id))).toHaveLength(3);
  });

  it('changes nothing when the page already has the rotation asked for', async () => {
    const { paper, page } = await ownPage();
    const before = await row(page.id);
    const same = await world.people.manager.client.school.rotateQuestionPaperPage({ ...key(), pageId: page.id, rotation: page.rotation, expectedPageRevision: paper.pageRevision });
    expect(same).toMatchObject({ pageRevision: paper.pageRevision, page: { rotation: page.rotation, derivativeRevision: page.derivativeRevision } });
    expect(await row(page.id)).toEqual(before);
  });

  it('refuses a stale revision, an unknown page and an invalid rotation, and leaves no object behind', async () => {
    const { paper, page } = await ownPage();
    const before = await row(page.id);
    const objectsBefore = await storedKeys(pagePrefix(page.id));
    const client = world.people.manager.client.school;
    await expect(client.rotateQuestionPaperPage({ ...key(), pageId: page.id, rotation: 180, expectedPageRevision: paper.pageRevision - 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(client.rotateQuestionPaperPage({ ...key(), pageId: 'qpg_unknown', rotation: 180, expectedPageRevision: paper.pageRevision })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A page id of another paper is not found under this paper's key.
    await upload(await landscape(), 'image/jpeg', 'other.jpg', { subjectSlug: 'math' });
    await expect(client.rotateQuestionPaperPage({ ...key({ subjectSlug: 'math' }), pageId: page.id, rotation: 180, expectedPageRevision: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(client.rotateQuestionPaperPage({ ...key(), pageId: page.id, rotation: 45 as 90, expectedPageRevision: paper.pageRevision })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await row(page.id)).toEqual(before);
    expect(await storedKeys(pagePrefix(page.id))).toEqual(objectsBefore);
    expect((await client.getQuestionPaperDetail(key())).paper.pageRevision).toBe(paper.pageRevision);
  });

  it('is refused to people who may not change the class\'s papers', async () => {
    const { paper, page } = await ownPage();
    const input = { ...key(), pageId: page.id, rotation: 270 as const, expectedPageRevision: paper.pageRevision };
    await expect(world.people.otherTeacher.client.school.rotateQuestionPaperPage(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(world.people.accountant.client.school.rotateQuestionPaperPage(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await row(page.id)).rotation).toBe(page.rotation);
  });

  it('refuses a HEIC page the server cannot decode, with a reason, and changes nothing', async () => {
    const k = { subjectSlug: 'math', modeSlug: 'practical' };
    const { page, pageRevision } = await upload(HEVC_STILL, 'image/heic', 'IMG_0042.HEIC', k);
    const before = await row(page.id);
    expect(before.derivativeStatus).toBe('unsupported');
    await expect(world.people.manager.client.school.rotateQuestionPaperPage({ ...key(k), pageId: page.id, rotation: 90, expectedPageRevision: pageRevision })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('cannot be turned'),
    });
    expect(await row(page.id)).toEqual(before);
    expect(await storedKeys(pagePrefix(page.id))).toEqual([before.originalS3Key]);
    // It has no copy for the viewer either: the viewer falls back to the original.
    expect((await read(page.id, 'model', k)).status).toBe(404);
    // The table holds the rule too: an undecodable page has no turned derivatives, so it cannot carry a turn.
    await expect(db.update(examQuestionPaperPageTable).set({ rotation: 90 }).where(eq(examQuestionPaperPageTable.id, page.id))).rejects.toMatchObject({
      cause: expect.objectContaining({ constraint: 'exam_question_paper_page_rotation_check' }),
    });
  });

  it('makes a generation start from the turned pages: the old revision is refused, and a running one blocks turning', async () => {
    configureQuestionPaperModel(fakeModel);
    const k = { classId: world.otherClassId, subjectSlug: 'science' };
    const { page, pageRevision } = await upload(await landscape(), 'image/jpeg', 'sideways.jpg', k);
    const client = world.people.manager.client.school;
    const turned = await client.rotateQuestionPaperPage({ ...key(k), pageId: page.id, rotation: 270, expectedPageRevision: pageRevision });
    const scope = await resolvePaperScope(db, key(k));
    const start = (expectedPageRevision: number) => startQuestionPaperGeneration(db, { scope, userId: world.people.manager.userId, expectedPageRevision, dispatch: () => {} });
    await expect(start(pageRevision)).rejects.toMatchObject({ code: 'CONFLICT' });
    const { jobId } = await start(turned.pageRevision);
    try {
      await expect(client.rotateQuestionPaperPage({ ...key(k), pageId: page.id, rotation: 0, expectedPageRevision: turned.pageRevision })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('A page cannot be turned while the AI is generating'),
      });
      expect((await row(page.id)).rotation).toBe(270);
    } finally {
      await db.update(examQuestionPaperJobTable).set({ status: 'failed', errorCode: 'model_busy', errorMessage: 'Busy.', completedAt: new Date() }).where(eq(examQuestionPaperJobTable.id, jobId));
    }
  });

  it('is refused once the exam has ended', async () => {
    const { paper, page } = await ownPage();
    await world.setLifecycle('completed');
    try {
      await expect(world.people.manager.client.school.rotateQuestionPaperPage({ ...key(), pageId: page.id, rotation: 180, expectedPageRevision: paper.pageRevision })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('has ended'),
      });
    } finally {
      await world.setLifecycle('ready');
    }
  });
});
