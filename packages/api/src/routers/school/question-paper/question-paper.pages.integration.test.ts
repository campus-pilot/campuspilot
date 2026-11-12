import { readFileSync } from 'node:fs';

import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { assistantConversationTable, assistantModelRequestTable, assistantRunTable } from '@campuspilot/db/schema/assistant';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperJobTable,
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { examPlanTable } from '@campuspilot/db/schema/exam';
import { env as assistantEnv } from '@campuspilot/env/assistant';
import { env } from '@campuspilot/env/server';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { getS3Client } from '@campuspilot/s3/client';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { expectFeatureDisabled } from '../../../../test/feature-flags';
import { createHandlerContext, setTestSchoolFeature } from '../../../../test/fixtures';
import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../../test/question-paper';
import { configureQuestionPaperModel, type QuestionPaperModel } from '../../../workflows/question-paper/model';
import { handleQuestionPaperPageRead, handleQuestionPaperPageUpload } from './question-paper.http';
import {
  addQuestionPaperFigure,
  addQuestionPaperPage,
  deleteQuestionPaper,
  deleteQuestionPaperPage,
  reorderQuestionPaperPages,
  startQuestionPaperGeneration,
} from './question-paper.service';
import { resolvePaperScope } from './question-paper.scope';
import { QUESTION_PAPER_MAX_PAGE_BYTES } from './question-paper.dto';

const HEVC_STILL = readFileSync(new URL('../../../files/__fixtures__/hevc-still.heic', import.meta.url));
const ENGLISH_SCIENCE = QUESTION_PAPER_EXAMPLES['english-science'];

const jpeg = (width = 400, height = 300, background = '#ddd') => sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();

function uploadRequest(bytes: Uint8Array, type: string, filename: string, field = 'page') {
  const formData = new FormData();
  formData.set(field, new Blob([Uint8Array.from(bytes)], { type }), filename);
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
  return (result.Contents ?? []).map((object) => object.Key!);
}

const fakeModel = (imageMimeTypes: string[]): QuestionPaperModel => ({
  provider: 'gemini',
  model: 'fake-model',
  prices: { inputUsdPerMtok: '1', outputUsdPerMtok: '1', cacheReadUsdPerMtok: '0', cacheWriteUsdPerMtok: '0' },
  imageMimeTypes,
  generate: async () => {
    throw new Error('Not used by the API.');
  },
  failureKind: () => 'unknown',
  billedUsageOf: () => null,
});
const reason = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; data?: { reason?: string } }) => error);
const GEMINI_LIKE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ANTHROPIC_LIKE = ['image/jpeg', 'image/png', 'image/webp'];

describe('question paper pages', () => {
  let world: QuestionPaperWorld;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
  });
  afterEach(() => configureQuestionPaperModel(undefined));

  const key = (overrides = {}) => world.key(overrides);
  const upload = (who: keyof QuestionPaperWorld['people'], bytes: Uint8Array, type: string, filename: string, overrides = {}) =>
    handleQuestionPaperPageUpload(uploadRequest(bytes, type, filename), world.people[who].context, key(overrides));
  const read = (who: keyof QuestionPaperWorld['people'], pageId: string, variant: string, overrides = {}) =>
    handleQuestionPaperPageRead(world.people[who].context, key(overrides), { pageId, variant });
  const body = async (response: Response) => (await response.json()) as { page: { id: string; position: number; derivativeStatus: string; width: number | null; height: number | null; contentType: string; originalName: string; byteSize: number }; pageRevision: number };
  const pageRows = (overrides = {}) =>
    db
      .select()
      .from(examQuestionPaperPageTable)
      .innerJoin(examQuestionPaperTable, eq(examQuestionPaperTable.id, examQuestionPaperPageTable.paperId))
      .where(and(eq(examQuestionPaperTable.classId, key(overrides).classId), eq(examQuestionPaperTable.subjectSlug, key(overrides).subjectSlug), eq(examQuestionPaperTable.modeSlug, key(overrides).modeSlug)))
      .orderBy(examQuestionPaperPageTable.position);

  const firstPage = async (overrides = {}) => (await pageRows(overrides))[0]!.exam_question_paper_page;

  describe('uploading and reading a page photo', () => {
    it('stores the original with a thumbnail and a model copy, in order, and bumps the page revision', async () => {
      const first = await upload('manager', await jpeg(2000, 1000), 'image/jpeg', 'C:\\scans\\page 1.JPG');
      expect(first.status).toBe(200);
      const one = await body(first);
      expect(one).toMatchObject({ pageRevision: 1, page: { position: 1, derivativeStatus: 'ready', width: 2000, height: 1000, contentType: 'image/jpeg', originalName: 'page 1.JPG' } });

      const png = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#f00' } }).png().toBuffer();
      const webp = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#0f0' } }).webp().toBuffer();
      const two = await body(await upload('teacher', png, 'image/png', 'two.png'));
      const three = await body(await upload('principal', webp, 'image/webp', 'three.webp'));
      expect([two.page.position, three.page.position, three.pageRevision]).toEqual([2, 3, 3]);

      const rows = (await pageRows()).map((row) => row.exam_question_paper_page);
      expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
      const [original] = rows;
      for (const objectKey of [original!.originalS3Key, original!.thumbS3Key!, original!.modelS3Key!]) expect(await exists(objectKey), objectKey).toBe(true);
      expect(original!.originalS3Key).toMatch(new RegExp(`^schools/${world.schoolId}/exam-question-papers/pages/${original!.id}/original\\.jpg$`));
      expect(original).toMatchObject({ modelContentType: 'image/jpeg', uploadedBy: world.people.manager.userId });
      expect(original!.modelByteSize!).toBeGreaterThan(0);

      const detail = await world.people.teacher.client.school.getQuestionPaperDetail(key());
      expect(detail.pages.map((page) => page.id)).toEqual(rows.map((row) => row.id));
      expect(detail).toMatchObject({ paper: { pageCount: 3, pageRevision: 3 }, activeJob: null, lastFinishedJob: null, templateConfigured: true });
    });

    it('serves the thumbnail and the original through short-lived redirects', async () => {
      const page = await firstPage();
      const thumb = await read('teacher', page!.id, 'thumb');
      expect(thumb.status).toBe(302);
      expect(thumb.headers.get('cache-control')).toBe('private, max-age=240');
      const image = sharp(Buffer.from(await (await fetch(thumb.headers.get('location')!)).arrayBuffer()));
      expect(await image.metadata()).toMatchObject({ format: 'jpeg', width: 360, height: 180 });

      const original = await read('teacher', page!.id, 'original');
      expect(original.status).toBe(302);
      const download = await fetch(original.headers.get('location')!);
      expect(download.headers.get('content-disposition')).toContain('attachment');
      expect(Buffer.from(await download.arrayBuffer()).byteLength).toBe(page!.byteSize);
    });

    it('keeps an undecodable HEIC as an original-only page with the size its header states', async () => {
      const k = { subjectSlug: 'math', modeSlug: 'practical' };
      const heic = await upload('manager', HEVC_STILL, 'image/heic', 'IMG_0042.HEIC', k);
      expect(heic.status).toBe(200);
      const { page } = await body(heic);
      expect(page).toMatchObject({ derivativeStatus: 'unsupported', width: 64, height: 48, contentType: 'image/heic', originalName: 'IMG_0042.HEIC' });
      const row = await firstPage(k);
      expect([row!.thumbS3Key, row!.modelS3Key, row!.modelContentType, row!.modelByteSize]).toEqual([null, null, null, null]);
      expect(await exists(row!.originalS3Key)).toBe(true);
      expect((await read('manager', page.id, 'thumb', k)).status).toBe(404);
      expect((await read('manager', page.id, 'original', k)).status).toBe(302);

      // Browsers that do not know HEIC send a generic type; the name and the bytes decide.
      const generic = await upload('manager', HEVC_STILL, 'application/octet-stream', 'IMG_0043.heic', k);
      expect((await body(generic)).page).toMatchObject({ contentType: 'image/heic', derivativeStatus: 'unsupported' });
    });

    it.each([
      ['an AVIF photo', async () => ({ bytes: await sharp({ create: { width: 16, height: 16, channels: 3, background: '#888' } }).avif().toBuffer(), type: 'image/avif', name: 'a.avif' }), 415],
      ['AVIF declared as HEIC', async () => ({ bytes: await sharp({ create: { width: 16, height: 16, channels: 3, background: '#888' } }).avif().toBuffer(), type: 'image/heic', name: 'a.heic' }), 415],
      ['a PDF', async () => ({ bytes: Buffer.from('%PDF-1.7'), type: 'application/pdf', name: 'a.pdf' }), 415],
      ['a JPEG whose bytes are not a JPEG', async () => ({ bytes: Buffer.from('not an image'), type: 'image/jpeg', name: 'a.jpg' }), 415],
      ['a JPEG that cannot be decoded', async () => ({ bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]), type: 'image/jpeg', name: 'a.jpg' }), 415],
      ['a name that disagrees with the type', async () => ({ bytes: await jpeg(8, 8), type: 'image/jpeg', name: 'a.png' }), 415],
      ['a photo over 15 MiB', async () => ({ bytes: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(QUESTION_PAPER_MAX_PAGE_BYTES)]), type: 'image/jpeg', name: 'big.jpg' }), 413],
    ])('refuses %s and stores nothing', async (_label, make, status) => {
      const k = { classId: world.otherClassId, subjectSlug: 'science' };
      const { bytes, type, name } = await make();
      const response = await upload('manager', bytes, type, name, k);
      expect(response.status).toBe(status);
      expect(await pageRows(k)).toHaveLength(0);
    });

    it('refuses a wrong field name, two files and extra fields', async () => {
      const k = { classId: world.otherClassId, subjectSlug: 'science' };
      const small = await jpeg(8, 8);
      expect((await handleQuestionPaperPageUpload(uploadRequest(small, 'image/jpeg', 'a.jpg', 'photo'), world.people.manager.context, key(k))).status).toBe(400);
      const two = new FormData();
      two.append('page', new Blob([Uint8Array.from(small)], { type: 'image/jpeg' }), 'a.jpg');
      two.append('page', new Blob([Uint8Array.from(small)], { type: 'image/jpeg' }), 'b.jpg');
      expect((await handleQuestionPaperPageUpload(new Request('http://localhost/u', { method: 'POST', body: two }), world.people.manager.context, key(k))).status).toBe(400);
      const extra = new FormData();
      extra.append('page', new Blob([Uint8Array.from(small)], { type: 'image/jpeg' }), 'a.jpg');
      extra.append('note', 'x');
      expect((await handleQuestionPaperPageUpload(new Request('http://localhost/u', { method: 'POST', body: extra }), world.people.manager.context, key(k))).status).toBe(400);
      expect(await pageRows(k)).toHaveLength(0);
    });

    it('checks permission, the assistant gate, the key and the exam before reading anything', async () => {
      const k = { classId: world.otherClassId, subjectSlug: 'science' };
      const small = await jpeg(8, 8);
      // The teacher of another class, an accountant and an anonymous caller.
      expect((await upload('teacher', small, 'image/jpeg', 'a.jpg', k)).status).toBe(403);
      expect((await upload('accountant', small, 'image/jpeg', 'a.jpg', k)).status).toBe(403);
      expect((await handleQuestionPaperPageUpload(uploadRequest(small, 'image/jpeg', 'a.jpg'), createHandlerContext(null), key(k))).status).toBe(401);
      expect((await handleQuestionPaperPageRead(createHandlerContext(null), key(k), { pageId: 'x', variant: 'thumb' })).status).toBe(401);
      // A key with no plan, an unknown mode, a malformed key.
      expect((await upload('manager', small, 'image/jpeg', 'a.jpg', { subjectSlug: 'art' })).status).toBe(404);
      expect((await upload('manager', small, 'image/jpeg', 'a.jpg', { modeSlug: 'oral' })).status).toBe(400);
      expect((await handleQuestionPaperPageUpload(uploadRequest(small, 'image/jpeg', 'a.jpg'), world.people.manager.context, { schoolId: world.schoolId })).status).toBe(400);
      // The feature switched off: a plain refusal, nothing written.
      await setTestSchoolFeature(world.schoolId, 'assistant', false);
      try {
        const off = await upload('manager', small, 'image/jpeg', 'a.jpg', k);
        expect(off.status).toBe(403);
        expect(await off.json()).toMatchObject({ code: 'FORBIDDEN', message: 'AI assistant is not enabled for this school.' });
      } finally {
        await setTestSchoolFeature(world.schoolId, 'assistant', true);
      }
      expect(await pageRows(k)).toHaveLength(0);
    });

    it('lets only people who may read the class read its pages', async () => {
      const page = await firstPage();
      expect((await read('otherTeacher', page!.id, 'thumb')).status).toBe(403);
      expect((await read('accountant', page!.id, 'thumb')).status).toBe(403);
      expect((await read('coordinator', page!.id, 'thumb')).status).toBe(302);
      expect((await read('teacher', page!.id, 'preview')).status).toBe(404);
      expect((await read('teacher', 'qpg_missing', 'thumb')).status).toBe(404);
      // A page id of another paper is not found under this paper's key.
      expect((await read('teacher', page!.id, 'thumb', { subjectSlug: 'math' })).status).toBe(404);
    });

    it('refuses the 21st page', async () => {
      const k = { classId: world.otherClassId, subjectSlug: 'math' };
      const tiny = await jpeg(16, 16);
      for (let index = 0; index < 20; index += 1) expect((await upload('manager', tiny, 'image/jpeg', `p${index}.jpg`, k)).status).toBe(200);
      const over = await upload('manager', tiny, 'image/jpeg', 'p21.jpg', k);
      expect(over.status).toBe(400);
      expect(await over.json()).toMatchObject({ message: 'A paper can have at most 20 pages.' });
      expect(await pageRows(k)).toHaveLength(20);
    });
  });

  describe('exam lifecycle', () => {
    it('keeps the tab editable once the exam started and read-only once it completed (D16, D43)', async () => {
      const k = { subjectSlug: 'science', modeSlug: 'theory' };
      const small = await jpeg(8, 8);
      await world.setLifecycle('active');
      expect((await upload('teacher', small, 'image/jpeg', 'started.jpg', k)).status).toBe(200);
      await world.setLifecycle('completed');
      try {
        const refused = await upload('teacher', small, 'image/jpeg', 'late.jpg', k);
        expect(refused.status).toBe(400);
        expect(await refused.json()).toMatchObject({ message: expect.stringContaining('has ended') });
        const detail = await world.people.teacher.client.school.getQuestionPaperDetail(key(k));
        expect(detail.paper).toMatchObject({ examCompleted: true, sessionActive: true });
        const page = await firstPage(k);
        expect((await read('teacher', page!.id, 'thumb', k)).status).toBe(302);
        await expect(world.people.teacher.client.school.reorderQuestionPaperPages({ ...key(k), pageIds: detail.pages.map((p) => p.id), expectedPageRevision: detail.paper.pageRevision })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(world.people.teacher.client.school.deleteQuestionPaperPage({ ...key(k), pageId: page!.id, expectedPageRevision: detail.paper.pageRevision })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(world.people.teacher.client.school.deleteQuestionPaper(key(k))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(world.people.teacher.client.school.saveQuestionPaperVersion({ ...key(k), expectedVersionNo: 0, html: ENGLISH_SCIENCE })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('has ended') });
      } finally {
        await world.setLifecycle('ready');
      }
    });
  });

  describe('reordering and deleting pages', () => {
    const detail = (k = {}) => world.people.manager.client.school.getQuestionPaperDetail(key(k));

    it('reorders every page at once and rejects a stale revision, a partial list and an outsider', async () => {
      const before = await detail();
      const ids = before.pages.map((page) => page.id);
      const reversed = [...ids].reverse();
      const out = await world.people.teacher.client.school.reorderQuestionPaperPages({ ...key(), pageIds: reversed, expectedPageRevision: before.paper.pageRevision });
      expect(out.pageRevision).toBe(before.paper.pageRevision + 1);
      expect((await detail()).pages.map((page) => [page.id, page.position])).toEqual(reversed.map((id, index) => [id, index + 1]));

      const client = world.people.manager.client.school;
      await expect(client.reorderQuestionPaperPages({ ...key(), pageIds: ids, expectedPageRevision: before.paper.pageRevision })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(client.reorderQuestionPaperPages({ ...key(), pageIds: ids.slice(1), expectedPageRevision: out.pageRevision })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(client.reorderQuestionPaperPages({ ...key(), pageIds: [ids[0]!, ids[0]!, ids[1]!], expectedPageRevision: out.pageRevision })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(client.reorderQuestionPaperPages({ ...key(), pageIds: ['qpg_unknown', ...ids.slice(1)], expectedPageRevision: out.pageRevision })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(world.people.otherTeacher.client.school.reorderQuestionPaperPages({ ...key(), pageIds: ids, expectedPageRevision: out.pageRevision })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await detail()).paper.pageRevision).toBe(out.pageRevision);
    });

    it('deletes a page, renumbers the rest and removes its objects', async () => {
      const before = await detail();
      const target = before.pages[0]!;
      const rows = (await pageRows()).map((row) => row.exam_question_paper_page);
      const gone = rows.find((row) => row.id === target.id)!;
      await expect(world.people.manager.client.school.deleteQuestionPaperPage({ ...key(), pageId: target.id, expectedPageRevision: before.paper.pageRevision - 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
      const out = await world.people.teacher.client.school.deleteQuestionPaperPage({ ...key(), pageId: target.id, expectedPageRevision: before.paper.pageRevision });
      expect(out.pageRevision).toBe(before.paper.pageRevision + 1);
      const after = await detail();
      expect(after.pages.map((page) => page.position)).toEqual(Array.from({ length: before.pages.length - 1 }, (_, index) => index + 1));
      expect(after.pages.some((page) => page.id === target.id)).toBe(false);
      for (const objectKey of [gone.originalS3Key, gone.thumbS3Key!, gone.modelS3Key!]) expect(await exists(objectKey), objectKey).toBe(false);
      await expect(world.people.manager.client.school.deleteQuestionPaperPage({ ...key(), pageId: target.id, expectedPageRevision: out.pageRevision })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('completion racing a write', () => {
    it('refuses every write whose scope was resolved before the exam completed (the check is repeated under the session lock)', async () => {
      const k = { classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'practical' };
      const small = await jpeg(8, 8);
      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      await upload('manager', small, 'image/jpeg', 'one.jpg', k);
      const { paper, pages } = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      // The scope a request resolved just before the principal completed the exam.
      const staleScope = await resolvePaperScope(db, key(k));
      expect(staleScope.examCompleted).toBe(false);
      await world.setLifecycle('completed');
      try {
        const file = { bytes: Buffer.from(small), contentType: 'image/jpeg', extension: 'jpg', name: 'late.jpg' };
        const user = world.people.manager.userId;
        const ended = { code: 'BAD_REQUEST', message: expect.stringContaining('has ended') };
        await expect(addQuestionPaperPage(db, { scope: staleScope, userId: user, file })).rejects.toMatchObject(ended);
        await expect(reorderQuestionPaperPages(db, { scope: staleScope, pageIds: pages.map((page) => page.id), expectedPageRevision: paper.pageRevision })).rejects.toMatchObject(ended);
        await expect(deleteQuestionPaperPage(db, { scope: staleScope, pageId: pages[0]!.id, expectedPageRevision: paper.pageRevision })).rejects.toMatchObject(ended);
        await expect(startQuestionPaperGeneration(db, { scope: staleScope, userId: user, expectedPageRevision: paper.pageRevision, dispatch: () => {} })).rejects.toMatchObject(ended);
        await expect(addQuestionPaperFigure(db, { scope: staleScope, userId: user, bytes: Buffer.from(small) })).rejects.toMatchObject(ended);
        await expect(deleteQuestionPaper(db, { scope: staleScope })).rejects.toMatchObject(ended);
      } finally {
        await world.setLifecycle('ready');
      }
      const after = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      expect(after.pages).toHaveLength(1);
      expect(after.activeJob).toBeNull();
    });
  });

  describe('plan deletion racing a write', () => {
    it('refuses every write whose scope was resolved before the plan was deleted, creates no paper and leaves no object behind', async () => {
      const k = { classId: world.otherClassId, subjectSlug: 'science' };
      const small = await jpeg(8, 8);
      const staleScope = await resolvePaperScope(db, key(k));
      const [plan] = await db
        .select()
        .from(examPlanTable)
        .where(and(eq(examPlanTable.classId, k.classId), eq(examPlanTable.subjectSlug, k.subjectSlug)));
      const papersBefore = await db.select({ id: examQuestionPaperTable.id }).from(examQuestionPaperTable).where(and(eq(examQuestionPaperTable.classId, k.classId), eq(examQuestionPaperTable.subjectSlug, k.subjectSlug)));
      const objectsBefore = await storedKeys(`schools/${world.schoolId}/exam-question-papers/`);
      await db.delete(examPlanTable).where(eq(examPlanTable.id, plan!.id));
      try {
        const user = world.people.manager.userId;
        const gone = { code: 'NOT_FOUND' };
        const file = { bytes: Buffer.from(small), contentType: 'image/jpeg', extension: 'jpg', name: 'late.jpg' };
        await expect(addQuestionPaperPage(db, { scope: staleScope, userId: user, file })).rejects.toMatchObject(gone);
        await expect(addQuestionPaperFigure(db, { scope: staleScope, userId: user, bytes: Buffer.from(small) })).rejects.toMatchObject(gone);
      } finally {
        await db.insert(examPlanTable).values(plan!);
      }
      const papersAfter = await db.select({ id: examQuestionPaperTable.id }).from(examQuestionPaperTable).where(and(eq(examQuestionPaperTable.classId, k.classId), eq(examQuestionPaperTable.subjectSlug, k.subjectSlug)));
      expect(papersAfter).toHaveLength(papersBefore.length);
      expect(await storedKeys(`schools/${world.schoolId}/exam-question-papers/`)).toEqual(objectsBefore);
    });
  });

  describe('startQuestionPaperGeneration', () => {
    const start = (who: keyof QuestionPaperWorld['people'], overrides = {}, expectedPageRevision?: number) =>
      world.people[who].client.school.startQuestionPaperGeneration({ ...key(overrides), expectedPageRevision: expectedPageRevision ?? 0 });

    it('is refused without a model, without pages, with a stale revision and without a template', async () => {
      const k = { classId: world.otherClassId, subjectSlug: 'science' };
      expect(await reason(start('manager', k))).toMatchObject({ code: 'PRECONDITION_FAILED', data: { reason: 'provider_unavailable' } });

      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      expect(await reason(start('manager', k))).toMatchObject({ code: 'BAD_REQUEST', message: 'Upload at least one page before generating.' });
      await upload('manager', await jpeg(8, 8), 'image/jpeg', 'a.jpg', k);
      const { paper } = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      expect(await reason(start('manager', k, paper.pageRevision + 5))).toMatchObject({ code: 'CONFLICT' });

      const bare = await createQuestionPaperWorld({ template: false });
      const bareKey = bare.key();
      await handleQuestionPaperPageUpload(uploadRequest(await jpeg(8, 8), 'image/jpeg', 'a.jpg'), bare.people.manager.context, bareKey);
      expect(await reason(bare.people.manager.client.school.startQuestionPaperGeneration({ ...bareKey, expectedPageRevision: 1 }))).toMatchObject({
        code: 'PRECONDITION_FAILED',
        data: { reason: 'QUESTION_PAPER_TEMPLATE_MISSING' },
      });
    });

    it('is a human action: not offered to MCP clients or the assistant, and denied to those who may not manage the class', async () => {
      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      const k = { subjectSlug: 'science', modeSlug: 'theory' };
      const { paper } = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      expect(await reason(start('otherTeacher', k, paper.pageRevision))).toMatchObject({ code: 'FORBIDDEN' });
      expect(await reason(start('accountant', k, paper.pageRevision))).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('queues one job that snapshots the page order, hands it over after the commit and blocks page changes while it is active', async () => {
      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      const k = { subjectSlug: 'science', modeSlug: 'theory' };
      const detail = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      const dispatched: string[] = [];
      const queued = await startQuestionPaperGeneration(db, {
        scope: await resolvePaperScope(db, key(k)),
        userId: world.people.teacher.userId,
        expectedPageRevision: detail.paper.pageRevision,
        dispatch: (jobId) => dispatched.push(jobId),
      });
      expect(queued).toMatchObject({ status: 'queued' });
      expect(dispatched).toEqual([queued.jobId]);
      const [job] = await db.select().from(examQuestionPaperJobTable).where(eq(examQuestionPaperJobTable.id, queued.jobId));
      expect(job).toMatchObject({ status: 'queued', requestedBy: world.people.teacher.userId, pageIds: detail.pages.map((page) => page.id), pageRevision: detail.paper.pageRevision, attempt: 1, handedOverAt: null });

      const active = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      expect(active.activeJob).toMatchObject({ id: queued.jobId, status: 'queued' });
      const again = await reason(start('manager', k, detail.paper.pageRevision));
      expect(again).toMatchObject({ code: 'CONFLICT', message: 'A generation is already running for this paper.' });

      const small = await jpeg(8, 8);
      expect((await upload('manager', small, 'image/jpeg', 'x.jpg', k)).status).toBe(409);
      const client = world.people.manager.client.school;
      await expect(client.reorderQuestionPaperPages({ ...key(k), pageIds: detail.pages.map((page) => page.id), expectedPageRevision: detail.paper.pageRevision })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(client.deleteQuestionPaperPage({ ...key(k), pageId: detail.pages[0]!.id, expectedPageRevision: detail.paper.pageRevision })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(client.deleteQuestionPaper(key(k))).rejects.toMatchObject({ code: 'CONFLICT' });

      // Once the job ended, the failure is shown and editing is possible again.
      await db
        .update(examQuestionPaperJobTable)
        .set({ status: 'failed', errorCode: 'model_busy', errorMessage: 'The AI service is busy. Try again in a few minutes.', completedAt: new Date() })
        .where(eq(examQuestionPaperJobTable.id, queued.jobId));
      const failed = await client.getQuestionPaperDetail(key(k));
      expect(failed.activeJob).toBeNull();
      expect(failed.lastFinishedJob).toMatchObject({ id: queued.jobId, status: 'failed', errorCode: 'model_busy', errorMessage: 'The AI service is busy. Try again in a few minutes.' });
      const listed = await client.listQuestionPapers({ schoolId: world.schoolId, sessionId: world.sessionId, examSlug: 'term-1', classId: world.classId });
      const science = listed.classes[0]!.subjects.find((subject) => subject.subjectSlug === 'science')!;
      expect(science.modes[0]!.paper).toMatchObject({ activeJob: null, lastJobFailure: { errorCode: 'model_busy' } });
      expect((await upload('manager', small, 'image/jpeg', 'y.jpg', k)).status).toBe(200);
    });

    it('goes through the router and leaves the hand-over to the outbox when the workflow engine cannot be signed for', async () => {
      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      const k = { subjectSlug: 'math', modeSlug: 'theory' };
      await upload('manager', await jpeg(8, 8), 'image/jpeg', 'a.jpg', k);
      const { paper } = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      const { jobId, status } = await start('teacher', k, paper.pageRevision);
      expect(status).toBe('queued');
      // The request returned at once; the background hand-over failed visibly, without secrets in the message.
      let job;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        [job] = await db.select().from(examQuestionPaperJobTable).where(eq(examQuestionPaperJobTable.id, jobId));
        if (job!.handoverAttempts > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // A sweep running in another test file may also have tried (and failed) to hand it over.
      expect(job!.handoverAttempts).toBeGreaterThanOrEqual(1);
      expect(job).toMatchObject({ status: 'queued', handedOverAt: null, lastHandoverError: expect.stringContaining('WORKER_CONTROL_SECRET') });
    });

    it('refuses before any cost a page the configured model cannot read, and accepts it for a model that can', async () => {
      const k = { subjectSlug: 'math', modeSlug: 'practical' };
      await upload('manager', await jpeg(8, 8), 'image/jpeg', 'fine.jpg', k);
      await upload('manager', HEVC_STILL, 'image/heic', 'IMG_0042.HEIC', k);
      const { paper } = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      // The k key already holds a HEIC page from the upload tests, so the first unreadable page is reported by position.
      configureQuestionPaperModel(fakeModel(ANTHROPIC_LIKE));
      const refused = await reason(start('manager', k, paper.pageRevision));
      expect(refused).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/^Page \d+ \(IMG_004\d\.HEIC\) is in a format the AI model cannot read\. Convert it to JPEG and upload it again\.$/) });
      expect(await db.select().from(examQuestionPaperJobTable).where(eq(examQuestionPaperJobTable.paperId, (await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.modeSlug, 'practical')))[0]!.id))).toHaveLength(0);

      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      expect((await start('manager', k, paper.pageRevision)).status).toBe('queued');
    });

    it('refuses generation, and only generation, once the school reached its monthly AI limit', async () => {
      // A school of its own: the month's spend is cached per school for ten minutes.
      const limited = await createQuestionPaperWorld();
      await setTestSchoolFeature(limited.schoolId, 'assistant', true, { monthlyLimitUsd: 0.01, eligibleRoles: ['principal', 'manager', 'teacher', 'accountant', 'exam_coordinator'] });
      const [conversation] = await db.insert(assistantConversationTable).values({ schoolId: limited.schoolId, userId: limited.people.manager.userId, provider: 'gemini', model: 'm' }).returning();
      const [run] = await db
        .insert(assistantRunTable)
        .values({ conversationId: conversation!.id, schoolId: limited.schoolId, userId: limited.people.manager.userId, clientRequestId: crypto.randomUUID(), surface: 'panel', sequence: 1 })
        .returning();
      await db.insert(assistantModelRequestTable).values({
        source: 'chat', runId: run!.id, schoolId: limited.schoolId, userId: limited.people.manager.userId, requestKey: `${run!.id}:model:0`, provider: 'gemini', requestedModel: 'm', answeredModel: 'm',
        usageComplete: true, inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        inputUsdPerMtok: '1', outputUsdPerMtok: '1', cacheReadUsdPerMtok: '0', cacheWriteUsdPerMtok: '0', costUsd: '0.05',
      });
      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      const manager = limited.people.manager;
      await handleQuestionPaperPageUpload(uploadRequest(await jpeg(8, 8), 'image/jpeg', 'a.jpg'), manager.context, limited.key());
      const { paper } = await manager.client.school.getQuestionPaperDetail(limited.key());
      expect(await reason(manager.client.school.startQuestionPaperGeneration({ ...limited.key(), expectedPageRevision: paper.pageRevision }))).toMatchObject({
        code: 'PRECONDITION_FAILED',
        data: { reason: 'limit_reached' },
      });
      // Reading, editing and saving what exists does not spend model money, so it stays open.
      await expect(manager.client.school.getQuestionPaper(limited.key())).resolves.toBeDefined();
      expect((await handleQuestionPaperPageUpload(uploadRequest(await jpeg(8, 8), 'image/jpeg', 'b.jpg'), manager.context, limited.key())).status).toBe(200);
      await expect(manager.client.school.saveQuestionPaperVersion({ ...limited.key(), expectedVersionNo: 0, html: ENGLISH_SCIENCE })).resolves.toMatchObject({ versionNo: 1 });
    });

    it('caps the generations one school may have at once, so the cached spend check cannot be overshot by every paper of an exam', async () => {
      const crowded = await createQuestionPaperWorld();
      const manager = crowded.people.manager;
      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      const cap = assistantEnv.QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL;
      const targets = [
        { classId: crowded.classId, subjectSlug: 'science', modeSlug: 'theory' },
        { classId: crowded.classId, subjectSlug: 'math', modeSlug: 'theory' },
        { classId: crowded.classId, subjectSlug: 'math', modeSlug: 'practical' },
        { classId: crowded.otherClassId, subjectSlug: 'science', modeSlug: 'theory' },
        { classId: crowded.otherClassId, subjectSlug: 'math', modeSlug: 'theory' },
      ].slice(0, cap + 2);
      const startFor = async (target: (typeof targets)[number]) => {
        await handleQuestionPaperPageUpload(uploadRequest(await jpeg(8, 8), 'image/jpeg', 'a.jpg'), manager.context, crowded.key(target));
        const { paper } = await manager.client.school.getQuestionPaperDetail(crowded.key(target));
        return reason(manager.client.school.startQuestionPaperGeneration({ ...crowded.key(target), expectedPageRevision: paper.pageRevision }));
      };
      // Hand-over would reach for Restate; the job rows are what count.
      for (const target of targets.slice(0, cap)) expect(await startFor(target)).toBeNull();
      const refused = await startFor(targets[cap]!);
      expect(refused).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining(`already has ${cap} AI generation`) });
      // Another school is not affected by this school's jobs.
      const other = await createQuestionPaperWorld();
      await handleQuestionPaperPageUpload(uploadRequest(await jpeg(8, 8), 'image/jpeg', 'a.jpg'), other.people.manager.context, other.key());
      const { paper } = await other.people.manager.client.school.getQuestionPaperDetail(other.key());
      expect(await reason(other.people.manager.client.school.startQuestionPaperGeneration({ ...other.key(), expectedPageRevision: paper.pageRevision }))).toBeNull();
      // Finishing one frees a place.
      const [done] = await db.select().from(examQuestionPaperJobTable).where(eq(examQuestionPaperJobTable.schoolId, crowded.schoolId));
      await db.update(examQuestionPaperJobTable).set({ status: 'failed', errorCode: 'model_error', errorMessage: 'x', completedAt: new Date() }).where(eq(examQuestionPaperJobTable.id, done!.id));
      const { paper: again } = await manager.client.school.getQuestionPaperDetail(crowded.key(targets[cap]!));
      expect(await reason(manager.client.school.startQuestionPaperGeneration({ ...crowded.key(targets[cap]!), expectedPageRevision: again.pageRevision }))).toBeNull();
    });

    it('refuses to start once the exam ended or the school lost the feature', async () => {
      configureQuestionPaperModel(fakeModel(GEMINI_LIKE));
      const k = { classId: world.otherClassId, subjectSlug: 'science', modeSlug: 'theory' };
      await upload('manager', await jpeg(8, 8), 'image/jpeg', 'a.jpg', k);
      const { paper } = await world.people.manager.client.school.getQuestionPaperDetail(key(k));
      await world.setLifecycle('completed');
      try {
        expect(await reason(start('manager', k, paper.pageRevision))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('has ended') });
      } finally {
        await world.setLifecycle('ready');
      }
      await setTestSchoolFeature(world.schoolId, 'assistant', false);
      try {
        await expectFeatureDisabled(start('manager', k, paper.pageRevision), 'assistant');
      } finally {
        await setTestSchoolFeature(world.schoolId, 'assistant', true);
      }
    });
  });

  describe('figures and deletion', () => {
    it('refuses to validate a draft whose figures cannot be printed together (the printer counts them as base64)', async () => {
      const k = { classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'practical' };
      const manager = world.people.manager.client.school;
      const scope = await resolvePaperScope(db, key(k));
      const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#4488cc' } }).png().toBuffer();
      const figure = await addQuestionPaperFigure(db, { scope, userId: world.people.manager.userId, bytes: png });
      try {
        const html = ENGLISH_SCIENCE.replace('<h2 class="sec">Section A', `<figure><img data-figure-id="${figure.id}" alt="A figure" style="width:50%"></figure><h2 class="sec">Section A`);
        expect((await manager.validateQuestionPaperDraft({ ...key(k), html })).valid).toBe(true);
        // 9.1 MB raw is under the 12 MB cap, 12.1 MB as base64 is over it.
        await db.update(examQuestionPaperFigureTable).set({ byteSize: 9_100_000 }).where(eq(examQuestionPaperFigureTable.id, figure.id));
        const checked = await manager.validateQuestionPaperDraft({ ...key(k), html });
        expect(checked.valid).toBe(false);
        expect(checked.problems[0]).toContain('figure images of this paper are too large to print together');
      } finally {
        await deleteQuestionPaper(db, { scope });
      }
    });

    it('prints an uploaded figure of the paper, refuses another paper\'s, and deletes everything with the paper', async () => {
      const k = { classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'theory' };
      const manager = world.people.manager.client.school;
      const scope = await resolvePaperScope(db, key(k));
      const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#4488cc' } }).png().toBuffer();
      const figure = await addQuestionPaperFigure(db, { scope, userId: world.people.manager.userId, bytes: png });
      expect(figure).toMatchObject({ contentType: 'image/jpeg', width: 800, height: 600, schoolId: world.schoolId });
      expect(figure.s3Key).toMatch(/\/figures\/qpf_[a-z0-9]{21}\.jpg$/);
      expect(await exists(figure.s3Key)).toBe(true);

      const html = ENGLISH_SCIENCE.replace('<h2 class="sec">Section A', `<figure><img data-figure-id="${figure.id}" alt="A blue rectangle" style="width:50%"></figure><h2 class="sec">Section A`);
      const saved = await manager.saveQuestionPaperVersion({ ...key(k), expectedVersionNo: 0, html });
      const preview = await manager.getQuestionPaperPreview({ ...key(k), versionNo: saved.versionNo });
      expect(preview.html).toMatch(/<figure><img src="data:image\/jpeg;base64,[A-Za-z0-9+/=]+" alt="A blue rectangle" style="width:50%"><\/figure>/);

      // The same id under another paper's key is not that paper's figure.
      const elsewhere = await manager.validateQuestionPaperDraft({ ...key({ classId: world.otherClassId, subjectSlug: 'science' }), html });
      expect(elsewhere.valid).toBe(false);
      expect(elsewhere.problems[0]).toContain('This figure image does not belong to this paper.');

      const paperRows = await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, saved.paperId));
      const versions = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, saved.paperId));
      const artifactKeys = (await db.select().from(artifactTable).where(eq(artifactTable.id, versions[0]!.pdfArtifactId!))).map((row) => row.s3Key);
      const pageKeys = (await pageRows(k)).flatMap((row) => [row.exam_question_paper_page.originalS3Key, row.exam_question_paper_page.thumbS3Key!, row.exam_question_paper_page.modelS3Key!]);
      expect(pageKeys.length).toBeGreaterThan(0);
      expect(artifactKeys).toHaveLength(1);

      await expect(world.people.otherTeacher.client.school.deleteQuestionPaper(key(k))).resolves.toEqual({ deleted: true });
      expect(paperRows).toHaveLength(1);
      expect(await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, saved.paperId))).toHaveLength(0);
      expect(await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, saved.paperId))).toHaveLength(0);
      expect(await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.paperId, saved.paperId))).toHaveLength(0);
      expect(await db.select().from(artifactTable).where(eq(artifactTable.id, versions[0]!.pdfArtifactId!))).toHaveLength(0);
      for (const objectKey of [figure.s3Key, ...artifactKeys, ...pageKeys]) expect(await exists(objectKey), objectKey).toBe(false);
      // The template revision the version pinned is shared and stays.
      expect(await db.select().from(artifactTable).where(eq(artifactTable.id, versions[0]!.templateRevisionId))).toHaveLength(1);
    });

    it('removes the papers of a plan when the plan is deleted, and only that plan\'s subject', async () => {
      const k = { subjectSlug: 'math', modeSlug: 'theory' };
      const keep = { subjectSlug: 'science', modeSlug: 'theory' };
      const manager = world.people.manager.client.school;
      const before = (await pageRows(k)).map((row) => row.exam_question_paper_page);
      expect(before.length).toBeGreaterThan(0);
      const saved = await manager.saveQuestionPaperVersion({ ...key(k), expectedVersionNo: 0, html: ENGLISH_SCIENCE });
      const [version] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, saved.paperId));
      const keptBefore = (await pageRows(keep)).length;

      const [plan] = await db
        .select()
        .from(examPlanTable)
        .where(and(eq(examPlanTable.classId, world.classId), eq(examPlanTable.subjectSlug, 'math'), eq(examPlanTable.examSlug, 'term-1')));
      await manager.deleteExamPlan({ schoolId: world.schoolId, sessionId: world.sessionId, classId: world.classId, examPlanId: plan!.id });

      expect(await pageRows(k)).toHaveLength(0);
      expect(await pageRows({ ...k, modeSlug: 'practical' })).toHaveLength(0);
      for (const page of before) for (const objectKey of [page.originalS3Key, page.thumbS3Key, page.modelS3Key]) if (objectKey) expect(await exists(objectKey), objectKey).toBe(false);
      expect(await pageRows(keep)).toHaveLength(keptBefore);
      // Versions, their PDFs and the paper's jobs went with it.
      expect(await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, saved.paperId))).toHaveLength(0);
      expect(await db.select().from(artifactTable).where(eq(artifactTable.id, version!.pdfArtifactId!))).toHaveLength(0);
      expect(await db.select().from(examQuestionPaperJobTable).where(eq(examQuestionPaperJobTable.paperId, saved.paperId))).toHaveLength(0);
      await expect(manager.getQuestionPaper(key(k))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
