import { randomUUID } from 'node:crypto';

import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHandlerContext } from '../../test/fixtures';
import { settleDerivatives } from '../../test/image-derivatives';
import { personalSpaceOwner, type GoogleNewcomer } from '../../test/personal-space';
import { handleStandalonePaperPageStore } from '../routers/school/standalone-paper/standalone-paper.http';
import { configureQuestionPaperModel, type QuestionPaperModel } from '../workflows/question-paper/model';
import {
  PERSONAL_SPACE_LIMIT_REASONS,
  PERSONAL_SPACE_STORAGE_QUOTA_BYTES,
  STANDALONE_PAPER_MAX_VERSIONS,
  STANDALONE_SAVE_WINDOW_MS,
  STANDALONE_SAVES_PER_WINDOW,
  personalSpaceLimitOf,
} from './personal-space.limits';
import { personalSpaceStoredBytes } from './personal-space.storage';

/** The worker's image job runs inline (`test/image-derivatives.ts`), as in the question paper suites. */
vi.mock('../workflows/image-derivatives/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workflows/image-derivatives/outbox')>()),
  requestImageDerivatives: (await import('../../test/image-derivatives')).runDerivativesInline,
}));
/** The hand-over of a queued job would reach for Restate; the job rows are what count. */
vi.mock('../workflows/question-paper/restate', () => ({
  sendQuestionPaperStart: vi.fn(async () => {
    throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  }),
}));

/** The limits of a personal space (docs/personal-space.md "Limits"). */

const { 'english-science': ENGLISH_SCIENCE } = QUESTION_PAPER_EXAMPLES;
const DETAILS = { schoolName: 'Sunrise Public School', className: 'Class 8', subjectName: 'Science', examName: 'Half Yearly Examination' };

type Owner = GoogleNewcomer & { schoolId: string };

/** Uploads one photo as a new page of the paper through the real route, and lets the worker make its copies. */
async function uploadPage(owner: Owner, paperId: string): Promise<Response> {
  const { pages } = await owner.client.school.reserveStandalonePaperPages({ schoolId: owner.schoolId, paperId, fileNames: ['page.jpg'] });
  const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ddd' } }).jpeg().toBuffer();
  const form = new FormData();
  form.set('page', new Blob([Uint8Array.from(photo)], { type: 'image/jpeg' }), 'page.jpg');
  const response = await handleStandalonePaperPageStore(
    new Request('http://localhost/upload', { method: 'POST', body: form }),
    createHandlerContext(owner.session),
    { schoolId: owner.schoolId, paperId },
    pages[0]!.id,
  );
  await settleDerivatives();
  return response;
}

/** A figure row of `byteSize` bytes, standing in for stored images (its object is never read). */
async function storeFigureBytes(owner: Owner, paperId: string, byteSize: number) {
  await db.insert(examQuestionPaperFigureTable).values({
    paperId,
    schoolId: owner.schoolId,
    s3Key: `test/figures/${randomUUID()}.png`,
    contentType: 'image/png',
    byteSize,
    width: 10,
    height: 10,
    sha256: randomUUID(),
    createdBy: owner.userId,
  });
}

/** `count` versions of a paper saved by an agent at `createdAt`, numbered after the paper's latest. */
async function addVersions(owner: Owner, paperId: string, count: number, createdAt: Date) {
  const [paper] = await db.select({ latest: examQuestionPaperTable.latestVersionNo }).from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, paperId));
  const from = paper!.latest;
  await db.insert(examQuestionPaperVersionTable).values(
    Array.from({ length: count }, (_, index) => ({
      paperId,
      paperKind: 'standalone' as const,
      schoolId: owner.schoolId,
      versionNo: from + index + 1,
      contentHtml: '<p>Old</p>',
      contentSha256: randomUUID(),
      source: 'agent' as const,
      createdBy: owner.userId,
      createdAt,
    })),
  );
  await db.update(examQuestionPaperTable).set({ latestVersionNo: from + count }).where(eq(examQuestionPaperTable.id, paperId));
  return from + count;
}

const save = (owner: Owner, paperId: string, expectedVersionNo: number) =>
  owner.client.school.saveStandalonePaperVersion({ schoolId: owner.schoolId, paperId, expectedVersionNo, html: ENGLISH_SCIENCE, details: DETAILS });

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'the call should have been refused').not.toBeNull();
  return error as { code?: string; data?: { reason?: string } };
}

describe('the storage quota of a personal space', () => {
  it('counts every stored byte: photos with both copies, figures and PDFs', async () => {
    const owner = await personalSpaceOwner();
    const { paperId } = await owner.client.school.createStandalonePaper({ schoolId: owner.schoolId });
    expect((await uploadPage(owner, paperId)).status).toBe(200);
    await save(owner, paperId, 0);
    await storeFigureBytes(owner, paperId, 1234);

    const [page] = await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, paperId));
    expect(page).toMatchObject({ derivativeStatus: 'ready' });
    expect(page!.thumbByteSize).toBeGreaterThan(0);
    const [version] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, paperId));
    const [pdf] = await db.select().from(artifactTable).where(eq(artifactTable.id, version!.pdfArtifactId!));
    expect(await personalSpaceStoredBytes(db, owner.schoolId)).toBe(page!.byteSize! + page!.thumbByteSize! + page!.modelByteSize! + 1234 + pdf!.byteSize);
  });

  it('refuses a photo or a version that does not fit, and reserves nothing once the space is full', async () => {
    const owner = await personalSpaceOwner();
    const { paperId } = await owner.client.school.createStandalonePaper({ schoolId: owner.schoolId });
    // Leave room for ten bytes.
    await storeFigureBytes(owner, paperId, PERSONAL_SPACE_STORAGE_QUOTA_BYTES - 10);

    const photo = await uploadPage(owner, paperId);
    expect(photo.status).toBe(400);
    expect(await photo.text()).toContain('Your personal space is full');
    expect((await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, paperId))).map((row) => row.uploadStatus)).toEqual(['awaiting']);

    const version = await refusalOf(save(owner, paperId, 0));
    expect(version).toMatchObject({ code: 'BAD_REQUEST', data: { reason: PERSONAL_SPACE_LIMIT_REASONS.storage } });
    expect(personalSpaceLimitOf(version)).toBe('storage');
    expect(await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, paperId))).toEqual([]);

    await storeFigureBytes(owner, paperId, 10);
    const reserved = await refusalOf(owner.client.school.reserveStandalonePaperPages({ schoolId: owner.schoolId, paperId, fileNames: ['more.jpg'] }));
    expect(personalSpaceLimitOf(reserved)).toBe('storage');
  });
});

describe('the versions of a standalone paper', () => {
  it(`stops at ${STANDALONE_PAPER_MAX_VERSIONS} versions, before anything is printed`, async () => {
    const owner = await personalSpaceOwner();
    const { paperId } = await owner.client.school.createStandalonePaper({ schoolId: owner.schoolId });
    const latest = await addVersions(owner, paperId, STANDALONE_PAPER_MAX_VERSIONS, new Date(Date.now() - 60 * 60_000));
    const refused = await refusalOf(save(owner, paperId, latest));
    expect(refused).toMatchObject({ code: 'BAD_REQUEST', data: { reason: PERSONAL_SPACE_LIMIT_REASONS.versions } });
    // Another paper of the same space still saves.
    const other = await owner.client.school.createStandalonePaper({ schoolId: owner.schoolId });
    await expect(save(owner, other.paperId, 0)).resolves.toMatchObject({ versionNo: 1 });
  });

  it(`saves at most ${STANDALONE_SAVES_PER_WINDOW} versions a minute per space`, async () => {
    const owner = await personalSpaceOwner();
    const busy = await owner.client.school.createStandalonePaper({ schoolId: owner.schoolId });
    await addVersions(owner, busy.paperId, STANDALONE_SAVES_PER_WINDOW, new Date());
    const { paperId } = await owner.client.school.createStandalonePaper({ schoolId: owner.schoolId });

    const refused = await refusalOf(save(owner, paperId, 0));
    expect(refused).toMatchObject({ code: 'TOO_MANY_REQUESTS', data: { reason: PERSONAL_SPACE_LIMIT_REASONS.saveRate } });
    // Once those saves are older than the window, saving works again.
    await db
      .update(examQuestionPaperVersionTable)
      .set({ createdAt: new Date(Date.now() - 2 * STANDALONE_SAVE_WINDOW_MS) })
      .where(eq(examQuestionPaperVersionTable.paperId, busy.paperId));
    await expect(save(owner, paperId, 0)).resolves.toMatchObject({ versionNo: 1 });
  });
});

/** A configured model; starting a generation only needs one to exist. */
const FAKE_MODEL: QuestionPaperModel = {
  provider: 'gemini',
  model: 'fake-configured-model',
  prices: { inputUsdPerMtok: '2', outputUsdPerMtok: '10', cacheReadUsdPerMtok: '0.2', cacheWriteUsdPerMtok: '2.5' },
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  generate: async () => {
    throw new Error('Starting a generation calls no model.');
  },
  failureKind: () => 'unknown',
  billedUsageOf: () => null,
};

describe('AI generations of a personal space', () => {
  afterEach(() => configureQuestionPaperModel(undefined));

  /** A paper with one processed page, and the start of a generation over it. */
  async function startOn(owner: Owner) {
    const { paperId } = await owner.client.school.createStandalonePaper({ schoolId: owner.schoolId });
    expect((await uploadPage(owner, paperId)).status).toBe(200);
    const detail = await owner.client.school.getStandalonePaperDetail({ schoolId: owner.schoolId, paperId });
    return { paperId, start: () => owner.client.school.startStandalonePaperGeneration({ schoolId: owner.schoolId, paperId, expectedPageRevision: detail.paper.pageRevision }) };
  }

  it('runs one at a time', async () => {
    configureQuestionPaperModel(FAKE_MODEL);
    const owner = await personalSpaceOwner();
    const first = await startOn(owner);
    await expect(first.start()).resolves.toMatchObject({ status: 'queued' });
    const second = await startOn(owner);
    const refused = await refusalOf(second.start());
    expect(refused).toMatchObject({ code: 'CONFLICT' });
    expect((refused as { message?: string }).message).toContain('Your personal space already has 1 AI generation running');
  });

  it('does not start on a paper that could not save another version', async () => {
    configureQuestionPaperModel(FAKE_MODEL);
    const owner = await personalSpaceOwner();
    const full = await startOn(owner);
    await addVersions(owner, full.paperId, STANDALONE_PAPER_MAX_VERSIONS, new Date(Date.now() - 60 * 60_000));
    expect(personalSpaceLimitOf(await refusalOf(full.start()))).toBe('versions');
  });
});
