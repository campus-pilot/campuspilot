import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { examQuestionPaperVersionTable } from '@campuspilot/db/schema/exam-question-paper';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { and, eq, inArray } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { setTestSchoolFeature, type TestClient } from '../../../../test/fixtures';
import { personalSpaceOwner } from '../../../../test/personal-space';
import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../../test/question-paper';
import { personalSpaceStoredBytes } from '../../../personal-space/personal-space.storage';

/**
 * Word (.docx) downloads of saved versions (docs/question-papers.md "Word
 * download"), against the Pandoc and Gotenberg containers of the test stack.
 */

const { 'hindi-maths': HINDI_MATH, 'english-science': ENGLISH_SCIENCE } = QUESTION_PAPER_EXAMPLES;

/** The parts of a downloaded .docx. */
async function docxOf(url: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return { files, document: strFromU8(files['word/document.xml']!) };
}

/** The text of a document part, its runs joined (Pandoc writes words and spaces as runs of their own). */
const textOf = (xml: string) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]).join('');

const versionRow = async (paperId: string, versionNo: number) =>
  (await db.select().from(examQuestionPaperVersionTable).where(and(eq(examQuestionPaperVersionTable.paperId, paperId), eq(examQuestionPaperVersionTable.versionNo, versionNo))))[0]!;

describe('question paper Word downloads', () => {
  let world: QuestionPaperWorld;
  let teacher: TestClient;
  let paperId: string;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
    teacher = world.people.teacher.client;
    const saved = await world.people.manager.client.school.saveQuestionPaperVersion({ ...world.key(), expectedVersionNo: 0, html: HINDI_MATH });
    paperId = saved.paperId;
  });
  const key = (overrides = {}) => world.key(overrides);

  it('keeps the PDF the default: no format is the PDF, as before', async () => {
    const download = await teacher.school.getQuestionPaperDownload({ ...key(), versionNo: 1 });
    expect(download).toMatchObject({ fileName: 'Science_Class 8_Theory_v1.pdf', expiresIn: 300 });
    const response = await fetch(download.url);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect((await versionRow(paperId, 1)).docxArtifactId).toBeNull();
  });

  it('makes the Word file on the first download, with native equations, the heading and a footer on every page', async () => {
    const download = await teacher.school.getQuestionPaperDownload({ ...key(), versionNo: 1, format: 'docx' });
    expect(download).toMatchObject({ fileName: 'Science_Class 8_Theory_v1.docx', expiresIn: 300 });
    const { files, document } = await docxOf(download.url);
    expect(document).toContain('<m:oMath>');
    expect(textOf(document)).toContain('Question Paper School');
    expect(document).toContain('<w:footerReference');
    expect(strFromU8(files['word/footer1.xml']!)).toContain('Term I Examination - Science');
    // A4 portrait, as the reference document states it (attribute order is Pandoc's, so each value is checked on its own).
    const pageSize = /<w:pgSz [^>]*>/.exec(document)?.[0] ?? '';
    expect(pageSize).toMatch(/w:w="11906"/);
    expect(pageSize).toMatch(/w:h="16838"/);
    expect(/<w:sectPr>[\s\S]*<w:footerReference [^>]*w:type="default"/.test(document)).toBe(true);
    // Pandoc fills in the parts the reference document leaves out.
    for (const part of ['word/settings.xml', 'word/fontTable.xml', 'word/theme/theme1.xml', 'word/numbering.xml']) expect(files[part], part).toBeDefined();

    const version = await versionRow(paperId, 1);
    const [artifact] = await db.select().from(artifactTable).where(eq(artifactTable.id, version.docxArtifactId!));
    expect(artifact).toMatchObject({
      kind: 'docx',
      documentType: 'question_paper',
      schoolId: world.schoolId,
      s3Key: `schools/${world.schoolId}/documents/${artifact!.id}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      templateRevisionId: version.templateRevisionId,
    });
    // Its own fact: the PDF is untouched.
    expect(version.pdfArtifactId).not.toBe(version.docxArtifactId);
  });

  it('stores the Word file once and reuses it, also when two first downloads race', async () => {
    const before = (await versionRow(paperId, 1)).docxArtifactId;
    await teacher.school.getQuestionPaperDownload({ ...key(), versionNo: 1, format: 'docx' });
    expect((await versionRow(paperId, 1)).docxArtifactId).toBe(before);

    const second = await world.people.manager.client.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 1, html: ENGLISH_SCIENCE });
    await Promise.all([
      teacher.school.getQuestionPaperDownload({ ...key(), versionNo: second.versionNo, format: 'docx' }),
      world.people.manager.client.school.getQuestionPaperDownload({ ...key(), versionNo: second.versionNo, format: 'docx' }),
    ]);
    const stored = await db
      .select({ id: artifactTable.id })
      .from(artifactTable)
      .where(and(eq(artifactTable.schoolId, world.schoolId), eq(artifactTable.kind, 'docx')));
    const pointers = new Set([(await versionRow(paperId, 1)).docxArtifactId, (await versionRow(paperId, second.versionNo)).docxArtifactId]);
    expect(pointers.size).toBe(2);
    // The losing request's artifact was rolled back with its row; only the two pointed-to files exist.
    expect(stored.map((row) => row.id).sort()).toEqual([...pointers].sort());
  });

  it('makes the file again when its artifact was removed', async () => {
    const before = (await versionRow(paperId, 1)).docxArtifactId!;
    await db.delete(artifactTable).where(eq(artifactTable.id, before));
    expect((await versionRow(paperId, 1)).docxArtifactId).toBeNull();
    await teacher.school.getQuestionPaperDownload({ ...key(), versionNo: 1, format: 'docx' });
    const after = (await versionRow(paperId, 1)).docxArtifactId;
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('never turns a teacher’s literal \\( … \\) into an equation', async () => {
    const k = key({ subjectSlug: 'math' });
    const saved = await world.people.manager.client.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: '<p>Write \\(x\\) in your notebook.</p>' });
    const { url } = await teacher.school.getQuestionPaperDownload({ ...k, versionNo: saved.versionNo, format: 'docx' });
    const { document } = await docxOf(url);
    expect(document).not.toContain('<m:oMath>');
    expect(textOf(document)).toContain('Write \\(x\\) in your notebook.');
  });

  it('asks for the same permission and gate as the PDF, in the same order', async () => {
    await expectPermissionDenied(world.people.otherTeacher.client.school.getQuestionPaperDownload({ ...key(), versionNo: 1, format: 'docx' }));
    await expectPermissionDenied(world.people.accountant.client.school.getQuestionPaperDownload({ ...key(), versionNo: 1, format: 'docx' }));
    await setTestSchoolFeature(world.schoolId, 'assistant', false);
    try {
      await expectFeatureDisabled(teacher.school.getQuestionPaperDownload({ ...key(), versionNo: 1, format: 'docx' }), 'assistant');
    } finally {
      await setTestSchoolFeature(world.schoolId, 'assistant', true);
    }
    await expect(teacher.school.getQuestionPaperDownload({ ...key(), versionNo: 9, format: 'docx' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deletes the Word files with their paper', async () => {
    const k = key({ subjectSlug: 'math' });
    const version = await versionRow((await teacher.school.getQuestionPaper(k)).paper.paperId!, 1);
    const ids = [version.pdfArtifactId!, version.docxArtifactId!];
    await world.people.manager.client.school.deleteQuestionPaper(k);
    expect(await db.select().from(artifactTable).where(inArray(artifactTable.id, ids))).toEqual([]);
  });
});

describe('standalone question paper Word downloads', () => {
  it('downloads a personal space’s paper as Word, counted in the space’s storage like its PDF', async () => {
    const { client, schoolId } = await personalSpaceOwner();
    const { paperId } = await client.school.createStandalonePaper({ schoolId });
    await client.school.saveStandalonePaperVersion({
      schoolId,
      paperId,
      expectedVersionNo: 0,
      html: ENGLISH_SCIENCE,
      details: { schoolName: 'Sunrise Public School', className: 'Class 8', subjectName: 'Science', examName: 'Half Yearly Examination', maxMarks: null },
    });
    const pdf = await client.school.getStandalonePaperDownload({ schoolId, paperId, versionNo: 1 });
    expect(pdf.fileName).toBe('Science_Class 8_Half Yearly Examination_v1.pdf');
    const before = await personalSpaceStoredBytes(db, schoolId);

    const word = await client.school.getStandalonePaperDownload({ schoolId, paperId, versionNo: 1, format: 'docx' });
    expect(word.fileName).toBe('Science_Class 8_Half Yearly Examination_v1.docx');
    const { files, document } = await docxOf(word.url);
    // The plain shell has no heading and no footer of its own; the diagram is an image, the placeholder a box.
    expect(files['word/footer1.xml']).toBeUndefined();
    expect(Object.keys(files).some((name) => name.startsWith('word/media/'))).toBe(true);
    expect(textOf(document)).toContain('Figure to be added');

    const version = await versionRow(paperId, 1);
    const [artifact] = await db.select().from(artifactTable).where(eq(artifactTable.id, version.docxArtifactId!));
    expect(artifact).toMatchObject({ kind: 'docx', sessionId: null, examSlug: null, classId: null, templateRevisionId: null });
    expect(await personalSpaceStoredBytes(db, schoolId)).toBe(before + artifact!.byteSize);
  });
});
