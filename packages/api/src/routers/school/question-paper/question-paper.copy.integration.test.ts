import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { assistantConversationTable, assistantModelRequestTable, assistantRunTable } from '@campuspilot/db/schema/assistant';
import { examLifecycleTable, examPlanTable } from '@campuspilot/db/schema/exam';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { and, asc, eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { createTestSchoolMember, createTestSession, setTestSchoolFeature } from '../../../../test/fixtures';
import { createQuestionPaperWorld, switchAssistantRoles, type QuestionPaperWorld } from '../../../../test/question-paper';
import { assertQuestionPaperAssistantAccess } from './question-paper.access';
import { resolvePaperScope } from './question-paper.scope';
import { addQuestionPaperFigure } from './question-paper.service';
import { getObjectBytes, putObject } from './question-paper.storage';

const { 'english-science': ENGLISH_SCIENCE, 'hindi-maths': HINDI_MATH } = QUESTION_PAPER_EXAMPLES;

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error as { code: string; message: string; data?: { reason?: string } },
  );

type Key = ReturnType<QuestionPaperWorld['key']>;

/**
 * Adds the exam `term-2` (Term II Examination) to the world's active session, with
 * plans for the first class: `science` theory out of 30 (the world's term-1 science
 * paper is out of 20, so a copy's `plan_max_marks` shows whose plan it took) and
 * `math` theory out of 12.
 */
async function addTermTwo(world: QuestionPaperWorld) {
  const [session] = await db.select().from(schoolSessionTable).where(eq(schoolSessionTable.id, world.sessionId));
  const config = session!.sessionConfig!;
  await db
    .update(schoolSessionTable)
    .set({ sessionConfig: { ...config, examConfig: { ...config.examConfig, 'term-2': { name: 'Term II Examination', order: 2 } } } })
    .where(eq(schoolSessionTable.id, world.sessionId));
  await db.insert(examPlanTable).values([
    { schoolId: world.schoolId, sessionId: world.sessionId, classId: world.classId, examSlug: 'term-2', subjectSlug: 'science', totalMarks: 30, modeConfig: { theory: { percentage: 100, maxMarks: 30 } }, status: 'approved' },
    { schoolId: world.schoolId, sessionId: world.sessionId, classId: world.classId, examSlug: 'term-2', subjectSlug: 'math', totalMarks: 12, modeConfig: { theory: { percentage: 100, maxMarks: 12 } }, status: 'approved' },
  ]);
}

/** A small JPEG to use as a figure image. */
const figureJpeg = (background: string) => sharp({ create: { width: 90, height: 60, channels: 3, background } }).jpeg().toBuffer();

/** The fragment with one uploaded figure before its first section. */
const withFigure = (html: string, figureId: string) =>
  html.replace('<h2 class="sec">Section A', `<figure><img data-figure-id="${figureId}" alt="The diagram"></figure><h2 class="sec">Section A`);

async function versionsOf(paperId: string) {
  return db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, paperId)).orderBy(asc(examQuestionPaperVersionTable.versionNo));
}

async function paperOf(key: Key) {
  const [paper] = await db
    .select()
    .from(examQuestionPaperTable)
    .where(
      and(
        eq(examQuestionPaperTable.sessionId, key.sessionId),
        eq(examQuestionPaperTable.examSlug, key.examSlug),
        eq(examQuestionPaperTable.classId, key.classId),
        eq(examQuestionPaperTable.subjectSlug, key.subjectSlug),
        eq(examQuestionPaperTable.modeSlug, key.modeSlug),
      ),
    );
  return paper;
}

const figuresOf = (paperId: string) => db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.paperId, paperId));

async function pdfPagesOf(url: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return (await PDFDocument.load(new Uint8Array(await response.arrayBuffer()))).getPageCount();
}

/**
 * Starting a paper from an earlier paper (`listQuestionPaperCopySources`,
 * `copyQuestionPaperVersion`): a new version of the target, saved through the
 * one save path, with the source's figures copied into the target, and the
 * source never changed.
 */
describe('starting a paper from an earlier paper', () => {
  let world: QuestionPaperWorld;
  /** Term II science theory of the first class: the paper being started. */
  let target: Key;
  /** Term I science theory: two versions, the second printing an uploaded figure. */
  let termOne: Key;
  /** Last session's annual science theory paper (the session is no longer active). */
  let lastYear: Key;
  let sourceFigureId: string;

  /** Runs `write` with `sessionId` as the school's active session, then makes the world's own session active again. */
  async function whileActive(sessionId: string, write: () => Promise<void>) {
    await db.update(schoolSessionTable).set({ isActive: false }).where(eq(schoolSessionTable.id, world.sessionId));
    await db.update(schoolSessionTable).set({ isActive: true }).where(eq(schoolSessionTable.id, sessionId));
    try {
      await write();
    } finally {
      await db.update(schoolSessionTable).set({ isActive: false }).where(eq(schoolSessionTable.id, sessionId));
      await db.update(schoolSessionTable).set({ isActive: true }).where(eq(schoolSessionTable.id, world.sessionId));
    }
  }

  beforeAll(async () => {
    world = await createQuestionPaperWorld();
    await addTermTwo(world);
    const manager = world.people.manager.client;
    target = { ...world.key(), examSlug: 'term-2' };
    termOne = world.key();

    // Last session: the same class (a class row is not per session), its annual exam and a science plan out of 25.
    const previous = await createTestSession({ schoolId: world.schoolId, sessionStartYear: 2025, sessionEndYear: 2026, isActive: false });
    await db
      .update(schoolSessionTable)
      .set({ sessionConfig: { examConfig: { annual: { name: 'Annual Examination', order: 1 } }, coScholasticAreas: {}, gradingScale: {}, attendanceTracking: { enabled: false } } })
      .where(eq(schoolSessionTable.id, previous.id));
    await db.insert(examPlanTable).values({
      schoolId: world.schoolId,
      sessionId: previous.id,
      classId: world.classId,
      examSlug: 'annual',
      subjectSlug: 'science',
      totalMarks: 25,
      modeConfig: { theory: { percentage: 100, maxMarks: 25 } },
      status: 'approved',
    });
    lastYear = { ...world.key(), sessionId: previous.id, examSlug: 'annual' };
    await whileActive(previous.id, async () => {
      await manager.school.saveQuestionPaperVersion({ ...lastYear, expectedVersionNo: 0, html: HINDI_MATH });
    });

    // Term I science: version 1 plain, version 2 with an uploaded figure owned by that paper.
    await manager.school.saveQuestionPaperVersion({ ...termOne, expectedVersionNo: 0, html: ENGLISH_SCIENCE });
    const figure = await addQuestionPaperFigure(db, { scope: await resolvePaperScope(db, termOne), userId: world.people.manager.userId, bytes: await figureJpeg('#336699') });
    sourceFigureId = figure.id;
    await manager.school.saveQuestionPaperVersion({ ...termOne, expectedVersionNo: 1, html: withFigure(ENGLISH_SCIENCE, figure.id) });

    // Not sources of the target: another subject, another class, and a paper with no saved version.
    await manager.school.saveQuestionPaperVersion({ ...world.key({ subjectSlug: 'math' }), expectedVersionNo: 0, html: HINDI_MATH });
    await manager.school.saveQuestionPaperVersion({ ...world.key({ classId: world.otherClassId }), expectedVersionNo: 0, html: ENGLISH_SCIENCE });
    await db.insert(examQuestionPaperTable).values({ ...world.key(), examSlug: 'term-2', modeSlug: 'practical', createdBy: world.people.manager.userId });
  });

  describe('listQuestionPaperCopySources', () => {
    it('lists saved papers of the same class and subject from any exam and session, newest first, without the paper itself or papers with no version', async () => {
      const { sources } = await world.people.teacher.client.school.listQuestionPaperCopySources(target);
      expect(sources).toHaveLength(2);
      expect(sources[0]).toMatchObject({ key: termOne, sessionLabel: '2026–27', sessionActive: true, examName: 'Term I Examination', modeName: 'Theory', latestVersionNo: 2, planMaxMarks: 20 });
      expect(sources[1]).toMatchObject({ key: lastYear, sessionLabel: '2025–26', sessionActive: false, examName: 'Annual Examination', modeName: 'Theory', latestVersionNo: 1, planMaxMarks: 25 });
      expect(new Date(sources[0]!.savedAt).getTime()).toBeGreaterThanOrEqual(new Date(sources[1]!.savedAt).getTime());

      // From Term I's own paper, the target (no version yet) is not a source and Term I is not its own source.
      const fromTermOne = await world.people.teacher.client.school.listQuestionPaperCopySources(termOne);
      expect(fromTermOne.sources.map((source) => source.key)).toEqual([lastYear]);
    });
  });

  describe('copyQuestionPaperVersion', () => {
    it('saves a new version of the target with the source fragment and a PDF, under the target plan, and leaves the source untouched', async () => {
      const sourcePaper = (await paperOf(lastYear))!;
      const before = await versionsOf(sourcePaper.id);

      const saved = await world.people.teacher.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 0, source: { ...lastYear, versionNo: 1 } });
      expect(saved).toMatchObject({ versionNo: 1, planMaxMarks: 30, hasPdf: true, warnings: [] });

      const [copy] = await versionsOf(saved.paperId);
      expect(copy).toMatchObject({
        source: 'copy',
        sourceVersionId: before[0]!.id,
        sourceJobId: null,
        sourceConversationId: null,
        sourcePageIds: null,
        planMaxMarks: 30,
        contentHtml: before[0]!.contentHtml,
        contentSha256: before[0]!.contentSha256,
        createdBy: world.people.teacher.userId,
      });
      const [artifact] = await db.select().from(artifactTable).where(eq(artifactTable.id, copy!.pdfArtifactId!));
      expect(artifact).toMatchObject({ status: 'ready', documentType: 'question_paper', sessionId: world.sessionId, examSlug: 'term-2', classId: world.classId });
      const { url } = await world.people.teacher.client.school.getQuestionPaperDownload({ ...target, versionNo: 1 });
      expect(await pdfPagesOf(url)).toBeGreaterThanOrEqual(1);

      // The source paper did not change at all.
      expect(await versionsOf(sourcePaper.id)).toEqual(before);
      expect(await paperOf(lastYear)).toEqual(sourcePaper);

      const { versions } = await world.people.teacher.client.school.listQuestionPaperVersions(target);
      expect(versions[0]).toMatchObject({ versionNo: 1, source: 'copy', isLatest: true });
      // Now that the target has a version it is still not its own source.
      const { sources } = await world.people.teacher.client.school.listQuestionPaperCopySources(target);
      expect(sources.map((source) => source.key)).toEqual([termOne, lastYear]);
    });

    it('refuses a stale expectedVersionNo with CONFLICT before copying any figure', async () => {
      const targetPaper = (await paperOf(target))!;
      const error = await errorOf(world.people.teacher.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 0, source: { ...termOne, versionNo: 2 } }));
      expect(error).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('latest version is 1') });
      expect(await versionsOf(targetPaper.id)).toHaveLength(1);
      expect(await figuresOf(targetPaper.id)).toHaveLength(0);
    });

    it('copies the figures the source prints into the target, as figures of the target with their own objects, and reuses them on a second copy', async () => {
      const [sourceFigure] = await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.id, sourceFigureId));
      const saved = await world.people.teacher.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 1, source: { ...termOne, versionNo: 2 } });
      expect(saved).toMatchObject({ versionNo: 2, planMaxMarks: 30 });

      const figures = await figuresOf(saved.paperId);
      expect(figures).toHaveLength(1);
      const copied = figures[0]!;
      expect(copied).toMatchObject({
        schoolId: world.schoolId,
        sourceFigureId,
        sourceAttachmentId: null,
        sha256: sourceFigure!.sha256,
        byteSize: sourceFigure!.byteSize,
        contentType: sourceFigure!.contentType,
        createdBy: world.people.teacher.userId,
      });
      expect(copied.id).not.toBe(sourceFigureId);
      expect(copied.s3Key).toBe(`schools/${world.schoolId}/exam-question-papers/figures/${copied.id}.jpg`);
      expect(copied.s3Key).not.toBe(sourceFigure!.s3Key);
      expect((await getObjectBytes(copied.s3Key)).equals(await getObjectBytes(sourceFigure!.s3Key))).toBe(true);

      const stored = (await versionsOf(saved.paperId))[1]!;
      expect(stored.contentHtml).toContain(`data-figure-id="${copied.id}"`);
      expect(stored.contentHtml).not.toContain(sourceFigureId);
      // The placeholder of the example stays a placeholder.
      expect(stored.contentHtml).toContain('data-placeholder=');

      const preview = await world.people.teacher.client.school.getQuestionPaperPreview({ ...target, versionNo: 2 });
      expect(preview.html).toContain('data:image/jpeg;base64,');
      expect(preview.html).not.toContain('Figure unavailable');

      // The same source again: a third version, the same copied figure.
      const again = await world.people.teacher.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 2, source: { ...termOne, versionNo: 2 } });
      expect(again.versionNo).toBe(3);
      expect(await figuresOf(saved.paperId)).toHaveLength(1);
    });

    it('refuses a figure it cannot copy, saving nothing', async () => {
      // Term I mathematics with a figure whose stored object no longer matches its row.
      const mathOne = world.key({ subjectSlug: 'math' });
      const mathTwo = { ...mathOne, examSlug: 'term-2' };
      const figure = await addQuestionPaperFigure(db, { scope: await resolvePaperScope(db, mathOne), userId: world.people.manager.userId, bytes: await figureJpeg('#993366') });
      await world.people.manager.client.school.saveQuestionPaperVersion({ ...mathOne, expectedVersionNo: 1, html: withFigure(ENGLISH_SCIENCE, figure.id) });
      await putObject(figure.s3Key, await figureJpeg('#000000'), 'image/jpeg');

      const error = await errorOf(world.people.teacher.client.school.copyQuestionPaperVersion({ ...mathTwo, expectedVersionNo: 0, source: { ...mathOne, versionNo: 2 } }));
      expect(error).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'copy_figure_unavailable' } });
      const targetPaper = await paperOf(mathTwo);
      if (targetPaper) {
        expect(await versionsOf(targetPaper.id)).toHaveLength(0);
        expect(await figuresOf(targetPaper.id)).toHaveLength(0);
      }
      // Version 1 has no figure and still copies.
      expect(await world.people.teacher.client.school.copyQuestionPaperVersion({ ...mathTwo, expectedVersionNo: 0, source: { ...mathOne, versionNo: 1 } })).toMatchObject({ versionNo: 1, planMaxMarks: 12 });
    });

    it('refuses a source that is not another paper of the same class and subject, or does not exist', async () => {
      const teacher = world.people.teacher.client;
      expect(await errorOf(teacher.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...target, versionNo: 1 } }))).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'copy_source_is_target' } });
      expect(await errorOf(teacher.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...world.key({ subjectSlug: 'math' }), versionNo: 1 } }))).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'copy_source_mismatch' } });
      expect(await errorOf(teacher.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...termOne, versionNo: 9 } }))).toMatchObject({ code: 'NOT_FOUND', data: { reason: 'copy_source_not_found' } });
      expect(await errorOf(teacher.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...termOne, examSlug: 'nope', versionNo: 1 } }))).toMatchObject({ code: 'NOT_FOUND', data: { reason: 'copy_source_not_found' } });
      expect((await versionsOf((await paperOf(target))!.id))).toHaveLength(3);
    });
  });

  describe('who may copy (OPA on both classes, then the assistant gate, then the papers)', () => {
    it('needs manage on the target and read on the source class, before anything else is looked at', async () => {
      const other = world.people.otherTeacher.client;
      // No manage on the target: a plain permission denial, for the list as well.
      await expectPermissionDenied(other.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...termOne, versionNo: 1 } }));
      await expectPermissionDenied(other.school.listQuestionPaperCopySources(target));
      // An accountant may do neither.
      await expectPermissionDenied(world.people.accountant.client.school.listQuestionPaperCopySources(target));
      // No read on the source class: refused by permission before the class mismatch (or the paper) is looked at.
      const otherClassPaper = world.key({ classId: world.otherClassId });
      await expectPermissionDenied(world.people.teacher.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...otherClassPaper, versionNo: 1 } }));
      // A manager reads every class, so the same request reaches the key check.
      expect(await errorOf(world.people.manager.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...otherClassPaper, versionNo: 1 } }))).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'copy_source_mismatch' } });
    });

    it('is refused while the assistant is off, and for a role not switched on, after the permission check', async () => {
      await setTestSchoolFeature(world.schoolId, 'assistant', false);
      try {
        await expectFeatureDisabled(world.people.teacher.client.school.listQuestionPaperCopySources(target), 'assistant');
        await expectFeatureDisabled(world.people.teacher.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...termOne, versionNo: 1 } }), 'assistant');
        // A caller without the class permission still learns nothing about the feature.
        await expectPermissionDenied(world.people.otherTeacher.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...termOne, versionNo: 1 } }));
      } finally {
        await setTestSchoolFeature(world.schoolId, 'assistant', true);
      }
      await switchAssistantRoles(world.schoolId, ['principal', 'manager', 'teacher']);
      try {
        expect(await errorOf(world.people.coordinator.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...termOne, versionNo: 1 } }))).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'role_not_enabled' } });
      } finally {
        await switchAssistantRoles(world.schoolId, ['principal', 'manager', 'teacher', 'exam_coordinator']);
      }
      expect((await versionsOf((await paperOf(target))!.id))).toHaveLength(3);
    });
  });

  describe('a target that cannot be changed', () => {
    it('refuses a copy into a completed exam and into a session that is not active (paper_locked), and copies once the exam is open again', async () => {
      await db.insert(examLifecycleTable).values({ schoolId: world.schoolId, sessionId: world.sessionId, examSlug: 'term-2', status: 'completed' });
      try {
        expect(await errorOf(world.people.manager.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 3, source: { ...termOne, versionNo: 1 } }))).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'paper_locked' } });
      } finally {
        await db.delete(examLifecycleTable).where(and(eq(examLifecycleTable.sessionId, world.sessionId), eq(examLifecycleTable.examSlug, 'term-2')));
      }
      // Last session's paper as the target: its session is not the active one.
      expect(await errorOf(world.people.manager.client.school.copyQuestionPaperVersion({ ...lastYear, expectedVersionNo: 1, source: { ...termOne, versionNo: 1 } }))).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'paper_locked' } });
      expect((await versionsOf((await paperOf(lastYear))!.id))).toHaveLength(1);
      expect((await versionsOf((await paperOf(target))!.id))).toHaveLength(3);
    });
  });

  describe('deleting', () => {
    it('keeps a copy printing its figures after the source paper is deleted, and deleting the copy removes the copied objects', async () => {
      const sourcePaper = (await paperOf(termOne))!;
      const sourceVersionIds = (await versionsOf(sourcePaper.id)).map((version) => version.id);
      const [sourceFigure] = await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.id, sourceFigureId));

      await world.people.manager.client.school.deleteQuestionPaper(termOne);
      expect(await paperOf(termOne)).toBeUndefined();
      await expect(getObjectBytes(sourceFigure!.s3Key)).rejects.toThrow();

      const targetPaper = (await paperOf(target))!;
      const copies = await versionsOf(targetPaper.id);
      expect(copies.map((version) => [version.versionNo, version.source])).toEqual([[1, 'copy'], [2, 'copy'], [3, 'copy']]);
      // The reference to a deleted version is cleared; the source fact stays.
      for (const version of copies.slice(1)) {
        expect(sourceVersionIds).not.toContain(version.sourceVersionId);
        expect(version.sourceVersionId).toBeNull();
      }
      const preview = await world.people.teacher.client.school.getQuestionPaperPreview({ ...target, versionNo: 2 });
      expect(preview.html).toContain('data:image/jpeg;base64,');
      expect(preview.html).not.toContain('Figure unavailable');

      const [copiedFigure] = await figuresOf(targetPaper.id);
      await world.people.manager.client.school.deleteQuestionPaper(target);
      expect(await figuresOf(targetPaper.id)).toHaveLength(0);
      await expect(getObjectBytes(copiedFigure!.s3Key)).rejects.toThrow();
    });

    it('deleting the target exam plan removes the copied figure objects and leaves the source paper and its figure alone', async () => {
      const mathOne = world.key({ subjectSlug: 'math' });
      const mathTwo = { ...mathOne, examSlug: 'term-2' };
      const figure = await addQuestionPaperFigure(db, { scope: await resolvePaperScope(db, mathOne), userId: world.people.manager.userId, bytes: await figureJpeg('#119966') });
      const sourceVersion = await world.people.manager.client.school.saveQuestionPaperVersion({ ...mathOne, expectedVersionNo: 2, html: withFigure(ENGLISH_SCIENCE, figure.id) });
      const copied = await world.people.manager.client.school.copyQuestionPaperVersion({ ...mathTwo, expectedVersionNo: 1, source: { ...mathOne, versionNo: sourceVersion.versionNo } });
      const [copiedFigure] = (await figuresOf(copied.paperId)).filter((row) => row.sourceFigureId === figure.id);
      expect(copiedFigure).toBeDefined();

      const [plan] = await db
        .select({ id: examPlanTable.id })
        .from(examPlanTable)
        .where(and(eq(examPlanTable.sessionId, world.sessionId), eq(examPlanTable.examSlug, 'term-2'), eq(examPlanTable.classId, world.classId), eq(examPlanTable.subjectSlug, 'math')));
      await world.people.manager.client.school.deleteExamPlan({ schoolId: world.schoolId, sessionId: world.sessionId, classId: world.classId, examPlanId: plan!.id });
      expect(await paperOf(mathTwo)).toBeUndefined();
      await expect(getObjectBytes(copiedFigure!.s3Key)).rejects.toThrow();
      // The source paper, its versions and its own figure object are untouched.
      expect((await versionsOf((await paperOf(mathOne))!.id)).map((version) => version.versionNo)).toEqual([1, 2, 3]);
      expect((await getObjectBytes(figure.s3Key)).byteLength).toBe(figure.byteSize);
    });
  });
});

describe('copying across schools and at the AI limit', () => {
  it('refuses a source in another school, by permission or, for a member of both schools, by the key check', async () => {
    const mine = await createQuestionPaperWorld();
    const theirs = await createQuestionPaperWorld();
    await theirs.people.manager.client.school.saveQuestionPaperVersion({ ...theirs.key(), expectedVersionNo: 0, html: ENGLISH_SCIENCE });
    const myTarget = mine.key({ subjectSlug: 'math' });
    const source = { ...theirs.key(), versionNo: 1 };

    await expectPermissionDenied(mine.people.manager.client.school.copyQuestionPaperVersion({ ...myTarget, expectedVersionNo: 0, source }));
    await createTestSchoolMember({ schoolId: theirs.schoolId, userId: mine.people.manager.userId, roles: [{ role: 'manager' }] });
    expect(await errorOf(mine.people.manager.client.school.copyQuestionPaperVersion({ ...myTarget, expectedVersionNo: 0, source }))).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'copy_source_mismatch' } });
    expect(await paperOf(myTarget)).toBeUndefined();
    expect((await mine.people.manager.client.school.listQuestionPaperCopySources(myTarget)).sources).toEqual([]);
  });

  it('copies for a school that reached its monthly AI limit (a copy calls no model)', async () => {
    const limited = await createQuestionPaperWorld();
    await addTermTwo(limited);
    await setTestSchoolFeature(limited.schoolId, 'assistant', true, { monthlyLimitUsd: 0.01, eligibleRoles: ['principal', 'manager', 'teacher', 'accountant', 'exam_coordinator'] });
    const manager = limited.people.manager;
    const [conversation] = await db.insert(assistantConversationTable).values({ schoolId: limited.schoolId, userId: manager.userId, provider: 'gemini', model: 'm' }).returning();
    const [run] = await db
      .insert(assistantRunTable)
      .values({ conversationId: conversation!.id, schoolId: limited.schoolId, userId: manager.userId, clientRequestId: crypto.randomUUID(), surface: 'panel', sequence: 1 })
      .returning();
    await db.insert(assistantModelRequestTable).values({
      source: 'chat', runId: run!.id, schoolId: limited.schoolId, userId: manager.userId, requestKey: `${run!.id}:model:0`, provider: 'gemini', requestedModel: 'm', answeredModel: 'm',
      usageComplete: true, inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
      inputUsdPerMtok: '1', outputUsdPerMtok: '1', cacheReadUsdPerMtok: '0', cacheWriteUsdPerMtok: '0', costUsd: '0.05',
    });
    // The school really is at its limit: anything that would spend model money is refused.
    await expect(assertQuestionPaperAssistantAccess(db, { schoolId: limited.schoolId, userId: manager.userId }, { useModel: true })).rejects.toMatchObject({ data: { reason: 'limit_reached' } });

    await manager.client.school.saveQuestionPaperVersion({ ...limited.key(), expectedVersionNo: 0, html: ENGLISH_SCIENCE });
    const target = { ...limited.key(), examSlug: 'term-2' };
    expect((await manager.client.school.listQuestionPaperCopySources(target)).sources).toHaveLength(1);
    expect(await manager.client.school.copyQuestionPaperVersion({ ...target, expectedVersionNo: 0, source: { ...limited.key(), versionNo: 1 } })).toMatchObject({ versionNo: 1, planMaxMarks: 30, hasPdf: true });
  });
});
