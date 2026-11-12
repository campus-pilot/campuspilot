import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { demoSchoolJobTable } from '@campuspilot/db/schema/demo-school-job';
import {
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { createAdminSession, createTestClient, type UserSession } from '../../../test/fixtures';
import { selectedQuestionPaperTemplate } from '../../routers/school/question-paper/question-paper.render';
import { DemoJobGuardError } from './job-context';
import { loadDemoJob, startDemoJob, type DemoJobSnapshot } from './job-store';
import { createSeedContext, seedClass, seedExamSetup, seedQuestionPaper, seedSession, seedStaffMember, seedTemplates, type SeedContext } from './steps';

/** Mid-December: the first term is completed, the second active, the annual ready. */
const AS_OF = '2026-12-20T06:30:00.000Z';
const run = { seed: 'question-paper-seed', asOf: AS_OF };

const exists = (key: string) => getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key })).then(() => true, () => false);

describe('demo question papers (steps only, one class)', () => {
  let admin: UserSession;
  let job: DemoJobSnapshot;
  let ctx: SeedContext;
  let sessionId: string;
  let classId: string;

  beforeAll(async () => {
    admin = await createAdminSession();
    const created = await createTestClient(admin).systemAdmin.createDemoSchool({
      name: 'Paper Valley School',
      location: 'Sample City',
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      classSlugs: ['class-7'],
    });
    await startDemoJob(created.job.id, 1, run);
    job = (await loadDemoJob(created.job.id))!;
    ctx = await createSeedContext(job, run);
    await seedStaffMember(ctx, ctx.plan.staff.find((member) => member.key === 'teacher-1')!);
    ({ sessionId } = await seedSession(ctx));
    ({ classId } = await seedClass(ctx, sessionId, ctx.plan.classes[0]!));
    for (const exam of ctx.plan.exams) await seedExamSetup(ctx, sessionId, exam);
    await seedTemplates(ctx);
  }, 300_000);

  const papers = () => db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.schoolId, job.schoolId)).orderBy(asc(examQuestionPaperTable.subjectSlug));
  const seedAll = () => Promise.all(ctx.plan.questionPapers.map((paper) => seedQuestionPaper(ctx, { sessionId, classIdsBySlug: { 'class-7': classId }, paper })));

  it('plans both papers into the upcoming exam, in a class that teaches the subject', () => {
    expect(ctx.plan.questionPapers.map(({ key, examSlug, classSlug, subjectSlug, modeSlug, classLabel }) => ({ key, examSlug, classSlug, subjectSlug, modeSlug, classLabel }))).toEqual([
      { key: 'science-english', examSlug: 'annual-examination', classSlug: 'class-7', subjectSlug: 'science', modeSlug: 'written', classLabel: 'Class 7' },
      { key: 'mathematics-hindi', examSlug: 'annual-examination', classSlug: 'class-7', subjectSlug: 'mathematics', modeSlug: 'written', classLabel: 'कक्षा 7' },
    ]);
  });

  it('selects the Question paper template although the demo has the assistant feature off', async () => {
    expect(await selectedQuestionPaperTemplate(db, job.schoolId)).toMatchObject({ name: 'Classic Question Paper' });
  });

  it('stores the pages and a first version printed as a PDF, dated from asOf', async () => {
    await seedAll();
    const rows = await papers();
    expect(rows.map((row) => [row.subjectSlug, row.examSlug, row.modeSlug, row.latestVersionNo, row.pageRevision])).toEqual([
      ['mathematics', 'annual-examination', 'written', 1, 2],
      ['science', 'annual-examination', 'written', 1, 2],
    ]);
    for (const [index, row] of rows.entries()) {
      const planned = ctx.plan.questionPapers.find((item) => item.subjectSlug === row.subjectSlug)!;
      expect(row.createdBy).toBe(admin.user.id);
      expect(row.createdAt.toISOString(), `${index}`).toBe(planned.uploadedAt);
      const pages = await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, row.id)).orderBy(asc(examQuestionPaperPageTable.position));
      expect(pages.map((page) => [page.position, page.originalName, page.contentType, page.derivativeStatus])).toEqual(
        planned.pages.map((page, position) => [position + 1, page.fileName, 'image/png', 'ready']),
      );
      expect(new Date(pages[0]!.createdAt).toISOString()).toBe(planned.uploadedAt);
      for (const page of pages) {
        for (const key of [page.originalS3Key, page.thumbS3Key!, page.modelS3Key!]) expect(await exists(key), key).toBe(true);
      }
      const [version] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, row.id));
      expect(version).toMatchObject({ versionNo: 1, source: 'agent', sourceConversationId: null, createdBy: admin.user.id });
      expect(version!.createdAt.toISOString()).toBe(planned.savedAt);
      expect(version!.content.meta.classLabel).toBe(planned.classLabel);
      const [pdf] = await db.select().from(artifactTable).where(eq(artifactTable.id, version!.pdfArtifactId!));
      expect(pdf).toMatchObject({ documentType: 'question_paper', kind: 'pdf', contentType: 'application/pdf', sessionId, examSlug: 'annual-examination', classId });
      expect(pdf!.createdAt.toISOString()).toBe(planned.savedAt);
      expect(await exists(pdf!.s3Key)).toBe(true);
      // Everything is dated before the demo's creation.
      expect(version!.createdAt.getTime()).toBeLessThan(new Date(AS_OF).getTime());
    }
  }, 120_000);

  it('changes nothing when the step runs again', async () => {
    const before = await papers();
    const pagesBefore = await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.schoolId, job.schoolId));
    const versionsBefore = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.schoolId, job.schoolId));
    await seedAll();
    expect(await papers()).toEqual(before);
    expect(await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.schoolId, job.schoolId))).toEqual(pagesBefore);
    expect(await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.schoolId, job.schoolId))).toEqual(versionsBefore);
  }, 120_000);

  it('adds only the missing pages after an interrupted run', async () => {
    const [row] = await papers();
    const [last] = await db.select().from(examQuestionPaperPageTable).where(and(eq(examQuestionPaperPageTable.paperId, row!.id), eq(examQuestionPaperPageTable.position, 2)));
    await db.delete(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, row!.id));
    await db.delete(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.id, last!.id));
    await db.update(examQuestionPaperTable).set({ latestVersionNo: 0 }).where(eq(examQuestionPaperTable.id, row!.id));
    const planned = ctx.plan.questionPapers.find((item) => item.subjectSlug === row!.subjectSlug)!;
    await expect(seedQuestionPaper(ctx, { sessionId, classIdsBySlug: { 'class-7': classId }, paper: planned })).resolves.toMatchObject({ paperId: row!.id, pages: 2 });
    const pages = await db.select({ position: examQuestionPaperPageTable.position }).from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, row!.id)).orderBy(asc(examQuestionPaperPageTable.position));
    expect(pages.map((page) => page.position)).toEqual([1, 2]);
    // The counter was rewound with the deleted version, so version 1 is written again.
    const versions = await db.select({ versionNo: examQuestionPaperVersionTable.versionNo }).from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, row!.id));
    expect(versions).toEqual([{ versionNo: 1 }]);
  }, 120_000);

  it('removes the objects it wrote when a purge was requested meanwhile, and stops', async () => {
    await db.update(demoSchoolJobTable).set({ purgeRequestedAt: new Date() }).where(eq(demoSchoolJobTable.id, job.jobId));
    const english = { ...ctx.plan.questionPapers[0]!, key: 'fence', subjectSlug: 'english', pages: [ctx.plan.questionPapers[0]!.pages[0]!] };
    await expect(seedQuestionPaper(ctx, { sessionId, classIdsBySlug: { 'class-7': classId }, paper: english })).rejects.toBeInstanceOf(DemoJobGuardError);
    const [paper] = await db.select().from(examQuestionPaperTable).where(and(eq(examQuestionPaperTable.schoolId, job.schoolId), eq(examQuestionPaperTable.subjectSlug, 'english')));
    const [page] = await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, paper!.id));
    for (const key of [page!.originalS3Key, page!.thumbS3Key!, page!.modelS3Key!]) expect(await exists(key), key).toBe(false);
    // The next step's context refuses too.
    await expect(createSeedContext(job, run)).rejects.toBeInstanceOf(DemoJobGuardError);
  });
});
