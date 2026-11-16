import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { examQuestionPaperPageTable } from '@campuspilot/db/schema/exam-question-paper';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { holdDerivatives, settleDerivatives } from '../../../../test/image-derivatives';
import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../../test/question-paper';
import { configureQuestionPaperModel, type QuestionPaperModel } from '../../../workflows/question-paper/model';
import { QUESTION_PAPER_PAGE_RESERVATION_TTL_MS } from './question-paper.dto';
import { handleQuestionPaperPageStore } from './question-paper.http';
import { releaseExpiredPageReservations } from './question-paper.service';

/** The worker's image job runs inline (`test/image-derivatives.ts`), only when a test lets it. */
vi.mock('../../../workflows/image-derivatives/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../workflows/image-derivatives/outbox')>()),
  requestImageDerivatives: (await import('../../../../test/image-derivatives')).runDerivativesInline,
}));

/** No job here is handed to a workflow engine; the tests assert on rows. */
vi.mock('../../../workflows/question-paper/restate', () => ({
  sendQuestionPaperStart: vi.fn(async () => {
    throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  }),
}));

const jpeg = (width: number, height: number, background: string) => sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();

function photoRequest(bytes: Uint8Array, filename: string) {
  const formData = new FormData();
  formData.set('page', new Blob([Uint8Array.from(bytes)], { type: 'image/jpeg' }), filename);
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

const fakeModel: QuestionPaperModel = {
  provider: 'gemini',
  model: 'fake-model',
  prices: { inputUsdPerMtok: '1', outputUsdPerMtok: '1', cacheReadUsdPerMtok: '0', cacheWriteUsdPerMtok: '0' },
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  generate: async () => {
    throw new Error('Not used by the API.');
  },
  failureKind: () => 'unknown',
  billedUsageOf: () => null,
};

describe('question paper page reservations', () => {
  let world: QuestionPaperWorld;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
  });
  afterEach(() => configureQuestionPaperModel(undefined));

  const manager = () => world.people.manager;
  const store = (overrides: object, pageId: string, bytes: Uint8Array, filename: string) =>
    handleQuestionPaperPageStore(photoRequest(bytes, filename), manager().context, world.key(overrides), pageId);
  const detail = (overrides: object) => manager().client.school.getQuestionPaperDetail(world.key(overrides));

  it('reserves pages in the order picked, and photos finishing in any order land on their own pages', async () => {
    const k = { subjectSlug: 'science', modeSlug: 'theory' };
    const reserved = await manager().client.school.reserveQuestionPaperPages({ ...world.key(k), fileNames: ['one.jpg', 'C:\\scans\\two.jpg', 'three.jpg'] });
    expect(reserved.pages.map((page) => [page.position, page.originalName, page.uploadStatus, page.derivativeStatus])).toEqual([
      [1, 'one.jpg', 'awaiting', 'pending'],
      [2, 'two.jpg', 'awaiting', 'pending'],
      [3, 'three.jpg', 'awaiting', 'pending'],
    ]);
    expect(reserved.pages.every((page) => page.contentType === null && page.byteSize === null && page.sha256 === null)).toBe(true);
    expect(reserved.pageRevision).toBe(1);

    // The last photo arrives first, the first last: positions stay those of the reservation.
    const colours = ['#f00', '#0f0', '#00f'];
    const responses = [];
    for (const index of [2, 0, 1]) {
      responses[index] = await store(k, reserved.pages[index]!.id, await jpeg(600, 800, colours[index]!), `photo-${index}.jpg`);
    }
    for (const response of responses) expect(response!.status).toBe(200);
    // The request answers before the worker ran: stored, still pending.
    expect(((await responses[0]!.json()) as { page: { uploadStatus: string; derivativeStatus: string } }).page).toMatchObject({ uploadStatus: 'stored', derivativeStatus: 'pending' });

    await settleDerivatives();
    const after = await detail(k);
    expect(after.pages.map((page) => [page.id, page.position, page.uploadStatus, page.derivativeStatus, page.contentType])).toEqual(
      reserved.pages.map((page) => [page.id, page.position, 'stored', 'ready', 'image/jpeg']),
    );
    // Storing photos changes no position, so the revision the teacher saw after reserving still holds.
    expect(after.paper.pageRevision).toBe(reserved.pageRevision);
    const rows = await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, after.paper.paperId!));
    for (const row of rows) for (const key of [row.originalS3Key!, row.thumbS3Key!, row.modelS3Key!]) expect(await exists(key), key).toBe(true);
  });

  it('refuses a second photo for a page and a page of another paper, and leaves no object behind', async () => {
    const k = { subjectSlug: 'math', modeSlug: 'theory' };
    const { pages } = await manager().client.school.reserveQuestionPaperPages({ ...world.key(k), fileNames: ['a.jpg'] });
    const photo = await jpeg(40, 40, '#888');
    expect((await store(k, pages[0]!.id, photo, 'a.jpg')).status).toBe(200);
    const again = await store(k, pages[0]!.id, photo, 'again.jpg');
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ message: 'This page already has its photo.' });
    // The same page id under another paper's key is not found there.
    expect((await store({ classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'theory' }, pages[0]!.id, photo, 'a.jpg')).status).toBe(404);
    await settleDerivatives();
  });

  it('releases a reservation whose upload failed, renumbers the rest, and refuses to release a stored page', async () => {
    const k = { classId: world.otherClassId, subjectSlug: 'science', modeSlug: 'theory' };
    const { pages, pageRevision } = await manager().client.school.reserveQuestionPaperPages({ ...world.key(k), fileNames: ['1.jpg', '2.jpg', '3.jpg'] });
    expect((await store(k, pages[0]!.id, await jpeg(40, 40, '#111'), '1.jpg')).status).toBe(200);

    const released = await manager().client.school.releaseQuestionPaperPage({ ...world.key(k), pageId: pages[1]!.id });
    expect(released).toEqual({ released: true, pageRevision: pageRevision + 1 });
    const after = await detail(k);
    expect(after.pages.map((page) => [page.id, page.position])).toEqual([
      [pages[0]!.id, 1],
      [pages[2]!.id, 2],
    ]);
    // Releasing it again is not an error; a page that has its photo is deleted, not released.
    expect(await manager().client.school.releaseQuestionPaperPage({ ...world.key(k), pageId: pages[1]!.id })).toMatchObject({ released: false });
    await expect(manager().client.school.releaseQuestionPaperPage({ ...world.key(k), pageId: pages[0]!.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    // A teacher who may not manage the class may not release either.
    await expect(world.people.teacher.client.school.releaseQuestionPaperPage({ ...world.key(k), pageId: pages[2]!.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await settleDerivatives();
  });

  it('refuses generation while a photo is still on its way or still being processed', async () => {
    configureQuestionPaperModel(fakeModel);
    const k = { classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'theory' };
    const { pages, pageRevision } = await manager().client.school.reserveQuestionPaperPages({ ...world.key(k), fileNames: ['first.jpg'] });
    const generate = () => manager().client.school.startQuestionPaperGeneration({ ...world.key(k), expectedPageRevision: pageRevision });
    await expect(generate()).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Page 1 (first.jpg) is still uploading. Wait for it to finish, or remove it, then generate.' });

    holdDerivatives();
    expect((await store(k, pages[0]!.id, await jpeg(40, 40, '#222'), 'first.jpg')).status).toBe(200);
    // Stored, but the worker has not run yet.
    await expect(generate()).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Page 1 (first.jpg) is still being processed. Try again in a moment.' });
    await settleDerivatives();
    expect((await detail(k)).pages[0]).toMatchObject({ derivativeStatus: 'ready' });
  });

  it('counts reservations toward the 20 page cap', async () => {
    const k = { subjectSlug: 'math', modeSlug: 'practical' };
    const names = Array.from({ length: 20 }, (_, index) => `${index}.jpg`);
    await manager().client.school.reserveQuestionPaperPages({ ...world.key(k), fileNames: names });
    await expect(manager().client.school.reserveQuestionPaperPages({ ...world.key(k), fileNames: ['21.jpg'] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'A paper can have at most 20 pages.',
    });
  });

  it('removes reservations whose photo never arrived once they expire, keeping fresh ones and stored pages', async () => {
    const k = { classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'practical' };
    const { pages } = await manager().client.school.reserveQuestionPaperPages({ ...world.key(k), fileNames: ['stored.jpg', 'lost.jpg', 'fresh.jpg'] });
    expect((await store(k, pages[0]!.id, await jpeg(40, 40, '#333'), 'stored.jpg')).status).toBe(200);
    await settleDerivatives();
    const old = new Date(Date.now() - QUESTION_PAPER_PAGE_RESERVATION_TTL_MS - 60_000);
    // The stored page is as old as the lost one: only a missing photo makes a page expire.
    for (const page of pages.slice(0, 2)) await db.update(examQuestionPaperPageTable).set({ createdAt: old }).where(eq(examQuestionPaperPageTable.id, page.id));
    const before = await detail(k);

    expect(await releaseExpiredPageReservations(db)).toMatchObject({ released: 1 });
    const after = await detail(k);
    expect(after.pages.map((page) => [page.originalName, page.position])).toEqual([
      ['stored.jpg', 1],
      ['fresh.jpg', 2],
    ]);
    expect(after.paper.pageRevision).toBe(before.paper.pageRevision + 1);
    // Nothing left to release.
    expect(await releaseExpiredPageReservations(db)).toMatchObject({ released: 0 });
  });
});
