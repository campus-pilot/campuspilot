import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperJobTable,
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { asc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { createHandlerContext, createTestClient } from '../../../../test/fixtures';
import { PERSONAL_SPACE_STORAGE_QUOTA_BYTES } from '../../../personal-space/personal-space.limits';
import { personalSpaceStoredBytes } from '../../../personal-space/personal-space.storage';
import { settleDerivatives } from '../../../../test/image-derivatives';
import { personalSpaceOwner } from '../../../../test/personal-space';
import { defaultGenerationDeps, runQuestionPaperGeneration, type StepRunner } from '../../../workflows/question-paper/generation';
import type { QuestionPaperModel, TextResult } from '../../../workflows/question-paper/model';
import { STANDALONE_PAPER_JOB_SYSTEM_PROMPT, TEMPLATE_PRINTS_START } from '../../../workflows/question-paper/prompt';
import { STANDALONE_QUESTION_PAPER_SHELL } from '../question-paper/question-paper.standalone-shell';
import { STANDALONE_PAPERS_PER_SPACE_LIMIT } from './standalone-paper.dto';
import { handleStandalonePaperPageStore } from './standalone-paper.http';

/** The worker's image job runs inline (`test/image-derivatives.ts`), as in the exam paper job's suite. */
vi.mock('../../../workflows/image-derivatives/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../workflows/image-derivatives/outbox')>()),
  requestImageDerivatives: (await import('../../../../test/image-derivatives')).runDerivativesInline,
}));

/** Standalone question papers of a personal space (docs/personal-space.md). */

const { 'english-science': ENGLISH_SCIENCE } = QUESTION_PAPER_EXAMPLES;

const DETAILS = { schoolName: 'Sunrise Public School', className: 'Class 8', subjectName: 'Science', examName: 'Half Yearly Examination' };

describe('standalone question papers', () => {
  it('creates a paper, saves versions with their details and lists, filters and searches by them', async () => {
    const { client, schoolId } = await personalSpaceOwner();
    const { paperId } = await client.school.createStandalonePaper({ schoolId });
    const empty = await client.school.getStandalonePaper({ schoolId, paperId });
    expect(empty).toMatchObject({ paper: { paperId, latestVersionNo: 0, details: { schoolName: null, className: null, subjectName: null, examName: null } }, version: null });
    // The plain page prints nothing, and that is known: two empty lists, never null.
    expect(empty.templatePrints).toEqual({ above: [], below: [] });

    const saved = await client.school.saveStandalonePaperVersion({ schoolId, paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: { ...DETAILS, schoolName: `  ${DETAILS.schoolName}  ` } });
    expect(saved).toMatchObject({ versionNo: 1, paperId, hasPdf: true });
    expect(saved).not.toHaveProperty('planMaxMarks');
    const [paper] = await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, paperId));
    expect(paper).toMatchObject({ kind: 'standalone', sessionId: null, examSlug: null, classId: null, detailsSchoolName: 'Sunrise Public School', detailsClassName: 'Class 8' });
    const [version] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, paperId));
    expect(version).toMatchObject({ paperKind: 'standalone', templateRevisionId: null, planMaxMarks: null });
    const [artifact] = await db.select().from(artifactTable).where(eq(artifactTable.id, version!.pdfArtifactId!));
    expect(artifact).toMatchObject({ templateRevisionId: null, sessionId: null, classId: null, name: 'Question paper: Science - Class 8 - Half Yearly Examination - v1' });

    // Not revisioned: the next save's details replace all four (a detail it leaves out is null).
    const edited = await client.school.editStandalonePaper({
      schoolId,
      paperId,
      expectedVersionNo: 1,
      edits: [{ find: 'All questions are compulsory.', replace: 'All questions are compulsory. Class 9.' }],
      details: { schoolName: DETAILS.schoolName, className: 'Class 9', subjectName: 'Science', examName: null },
    });
    expect(edited.versionNo).toBe(2);
    const detail = await client.school.getStandalonePaperDetail({ schoolId, paperId });
    expect(detail.paper.details).toEqual({ schoolName: DETAILS.schoolName, className: 'Class 9', subjectName: 'Science', examName: null });
    expect(detail.versions.map((row) => row.versionNo)).toEqual([2, 1]);

    const other = await client.school.createStandalonePaper({ schoolId });
    await client.school.saveStandalonePaperVersion({ schoolId, paperId: other.paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: { ...DETAILS, subjectName: 'Mathematics' } });
    expect(await client.school.listStandalonePaperFilterOptions({ schoolId })).toEqual({
      schoolNames: [DETAILS.schoolName],
      classNames: ['Class 8', 'Class 9'],
      subjectNames: ['Mathematics', 'Science'],
      examNames: [DETAILS.examName],
    });
    const bySubject = await client.school.listStandalonePapers({ schoolId, filters: { subjectName: 'Mathematics' } });
    expect(bySubject.items.map((item) => item.paperId)).toEqual([other.paperId]);
    const searched = await client.school.listStandalonePapers({ schoolId, searchQuery: 'class 9' });
    expect(searched.items.map((item) => item.paperId)).toEqual([paperId]);
    expect((await client.school.listStandalonePapers({ schoolId })).pagination.totalItems).toBe(2);
  });

  it('returns an unused paper instead of creating another, and caps the papers of a space', async () => {
    const { client, schoolId } = await personalSpaceOwner();
    const first = await client.school.createStandalonePaper({ schoolId });
    expect(first.reused).toBe(false);
    // No page, no version, no conversation: the same paper again, also for creations sent at once.
    const [again, alsoAgain] = await Promise.all([client.school.createStandalonePaper({ schoolId }), client.school.createStandalonePaper({ schoolId })]);
    expect(again).toEqual({ paperId: first.paperId, reused: true });
    expect(alsoAgain.paperId).toBe(first.paperId);
    // Once it holds a page it is used: a new paper is created.
    await client.school.reserveStandalonePaperPages({ schoolId, paperId: first.paperId, fileNames: ['page.jpg'] });
    const second = await client.school.createStandalonePaper({ schoolId });
    expect(second).toMatchObject({ reused: false });
    expect(second.paperId).not.toBe(first.paperId);
    await client.school.saveStandalonePaperVersion({ schoolId, paperId: second.paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: DETAILS });

    // At the cap, nothing more is created.
    await db.insert(examQuestionPaperTable).values(
      Array.from({ length: STANDALONE_PAPERS_PER_SPACE_LIMIT - 2 }, () => ({ schoolId, kind: 'standalone' as const, latestVersionNo: 1 })),
    );
    await expect(client.school.createStandalonePaper({ schoolId })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('prints in the built-in plain shell, with the body once', async () => {
    const { client, schoolId } = await personalSpaceOwner();
    const { paperId } = await client.school.createStandalonePaper({ schoolId });
    await client.school.saveStandalonePaperVersion({ schoolId, paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: DETAILS });
    const preview = await client.school.getStandalonePaperPreview({ schoolId, paperId, versionNo: 1 });
    expect(preview.templateName).toBeNull();
    expect(preview.html).toContain('class="qp-standalone"');
    expect(preview.html.match(/class="qp-body"/g)).toHaveLength(1);
    expect(STANDALONE_QUESTION_PAPER_SHELL.match(/questionPaper\.bodyHtml/g)).toHaveLength(1);
    const draft = await client.school.previewStandalonePaperDraft({ schoolId, paperId, html: ENGLISH_SCIENCE });
    expect(draft.problems).toEqual([]);
    expect(draft.html).toContain('class="qp-standalone"');
    const download = await client.school.getStandalonePaperDownload({ schoolId, paperId, versionNo: 1 });
    expect(download.fileName).toBe('Science_Class 8_Half Yearly Examination_v1.pdf');
  });

  it('does not reach another school’s paper, and deletes a paper with everything it holds', async () => {
    const owner = await personalSpaceOwner('Owner');
    const intruder = await personalSpaceOwner('Intruder');
    const { paperId } = await owner.client.school.createStandalonePaper({ schoolId: owner.schoolId });
    // Named under the intruder's own space, the owner's paper is not found there.
    await expect(intruder.client.school.getStandalonePaper({ schoolId: intruder.schoolId, paperId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await owner.client.school.saveStandalonePaperVersion({ schoolId: owner.schoolId, paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: DETAILS });
    await expect(owner.client.school.deleteStandalonePaper({ schoolId: owner.schoolId, paperId })).resolves.toEqual({ deleted: true });
    expect(await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, paperId))).toEqual([]);
  });
});

const answer = (text: string): TextResult => ({
  text,
  usage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  answeredModel: 'fake-answered-model',
  refusal: false,
  unfinished: false,
});

const direct: StepRunner = (_name, action) => action();

/** A standalone paper with one photographed page and a queued job over it, as `startStandalonePaperGeneration` makes one. */
async function queueStandaloneJob() {
  const { schoolId, userId, session } = await personalSpaceOwner();
  const context = createHandlerContext(session);
  const client = createTestClient(session);
  const { paperId } = await client.school.createStandalonePaper({ schoolId });
  const { pages } = await client.school.reserveStandalonePaperPages({ schoolId, paperId, fileNames: ['page.jpg'] });
  const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ddd' } }).jpeg().toBuffer();
  const form = new FormData();
  form.set('page', new Blob([Uint8Array.from(photo)], { type: 'image/jpeg' }), 'page.jpg');
  const response = await handleStandalonePaperPageStore(new Request('http://localhost/upload', { method: 'POST', body: form }), context, { schoolId, paperId }, pages[0]!.id);
  expect(response.status).toBe(200);
  await settleDerivatives();
  const pageRows = await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, paperId)).orderBy(asc(examQuestionPaperPageTable.position));
  const [paper] = await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, paperId));
  const [job] = await db
    .insert(examQuestionPaperJobTable)
    .values({ paperId, schoolId, requestedBy: userId, pageIds: pageRows.map((row) => row.id), pageRevision: paper!.pageRevision })
    .returning();
  return { schoolId, paperId, client, job: job! };
}

/** A model that answers each request with the next text, recording the requests. */
function scriptedModel(texts: string[]) {
  const requests: Array<Parameters<QuestionPaperModel['generate']>[0]> = [];
  const model: QuestionPaperModel = {
    provider: 'gemini',
    model: 'fake-configured-model',
    prices: { inputUsdPerMtok: '2', outputUsdPerMtok: '10', cacheReadUsdPerMtok: '0.2', cacheWriteUsdPerMtok: '2.5' },
    imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    generate: async (request) => {
      requests.push(request);
      const next = texts.shift();
      if (next === undefined) throw new Error('The scripted model is exhausted.');
      return answer(next);
    },
    failureKind: () => 'unknown',
    billedUsageOf: () => null,
  };
  return { model, requests };
}

const runJob = (jobId: string, model: QuestionPaperModel) =>
  runQuestionPaperGeneration({ jobId, attempt: 1 }, direct, { ...defaultGenerationDeps(), getModel: () => model, sleep: async () => {}, retryDelaysMs: [0, 0] });

const withDetails = (html: string, details: object) => `${html}\n\n\`\`\`paper-details\n${JSON.stringify(details)}\n\`\`\``;

describe('the generation job for a standalone paper', () => {
  it('writes the whole paper with no template and saves the details the model returned', async () => {
    const { paperId, job } = await queueStandaloneJob();
    const { model, requests } = scriptedModel([withDetails(ENGLISH_SCIENCE, DETAILS)]);
    expect(await runJob(job.id, model)).toEqual({ status: 'succeeded', versionNo: 1 });

    // The standalone prompt, and the (empty) lines printed around the paper: the whole heading is the model's.
    expect(requests[0]!.system).toBe(STANDALONE_PAPER_JOB_SYSTEM_PROMPT);
    const printed = requests[0]!.parts.at(-1) as { type: 'text'; text: string };
    expect(printed.text.startsWith(TEMPLATE_PRINTS_START)).toBe(true);
    expect(JSON.parse(printed.text.split('\n')[1]!)).toEqual({ above: [], below: [] });
    const [saved] = await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, paperId));
    expect(saved).toMatchObject({ detailsSchoolName: DETAILS.schoolName, detailsClassName: DETAILS.className, detailsSubjectName: DETAILS.subjectName, detailsExamName: DETAILS.examName });
    const [version] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, paperId));
    // The details block is not part of the paper.
    expect(version!.contentHtml).not.toContain('paper-details');
    expect(version).toMatchObject({ source: 'ai_job', templateRevisionId: null });
  });

  it('saves a valid first answer without a details block at once, keeping the paper’s stored details', async () => {
    const { schoolId, paperId, client, job } = await queueStandaloneJob();
    // The paper already states details from an earlier version.
    await client.school.saveStandalonePaperVersion({ schoolId, paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: DETAILS });
    const { model, requests } = scriptedModel([ENGLISH_SCIENCE]);
    expect(await runJob(job.id, model)).toEqual({ status: 'succeeded', versionNo: 2 });
    // A missing block alone costs no second request.
    expect(requests).toHaveLength(1);
    const [saved] = await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, paperId));
    // A version that states no details does not change them.
    expect(saved).toMatchObject({ detailsSchoolName: DETAILS.schoolName, detailsClassName: DETAILS.className, detailsSubjectName: DETAILS.subjectName, detailsExamName: DETAILS.examName });
  });

  it('asks for the missing block in a repair the paper needs anyway, and takes its details', async () => {
    const { paperId, job } = await queueStandaloneJob();
    const broken = ENGLISH_SCIENCE.replace('data-math="\\mathrm{H_2O}"', 'data-math="\\frac{1"');
    expect(broken).not.toBe(ENGLISH_SCIENCE);
    const { model, requests } = scriptedModel([broken, withDetails(ENGLISH_SCIENCE, { ...DETAILS, className: 'Class 6' })]);
    expect(await runJob(job.id, model)).toEqual({ status: 'succeeded', versionNo: 1 });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.parts)).toContain('no readable paper-details block');
    const [saved] = await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, paperId));
    expect(saved!.detailsClassName).toBe('Class 6');
  });

  it('fails with its own reason when the space filled up while the paper was being written', async () => {
    const { schoolId, paperId, job } = await queueStandaloneJob();
    // Room for ten bytes: the PDF does not fit.
    const stored = await personalSpaceStoredBytes(db, schoolId);
    await db.insert(examQuestionPaperFigureTable).values({
      paperId,
      schoolId,
      s3Key: `test/figures/${paperId}.png`,
      contentType: 'image/png',
      byteSize: PERSONAL_SPACE_STORAGE_QUOTA_BYTES - stored - 10,
      width: 10,
      height: 10,
      sha256: 'x',
      createdBy: job.requestedBy,
    });
    const { model } = scriptedModel([withDetails(ENGLISH_SCIENCE, DETAILS)]);
    await runJob(job.id, model);
    const [failed] = await db.select().from(examQuestionPaperJobTable).where(eq(examQuestionPaperJobTable.id, job.id));
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'storage_full' });
    expect(await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, paperId))).toEqual([]);
  });
});
