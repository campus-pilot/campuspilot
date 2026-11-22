import { db } from '@campuspilot/db';
import { examQuestionPaperTable, examQuestionPaperVersionTable } from '@campuspilot/db/schema/exam-question-paper';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { setTestSchoolFeature } from '../../../../test/fixtures';
import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../../test/question-paper';
import { QUICK_PAPER_NO_ACTIVE_SESSION_REASON } from '../question-paper/question-paper.print-context';
import { STANDALONE_PAPER_MAX_VERSIONS, STANDALONE_PAPERS_PER_SPACE_LIMIT } from '../../../personal-space/personal-space.limits';

/** Quick papers: standalone papers of a real school (docs/question-papers.md "Quick papers in a school"). */

const { 'english-science': ENGLISH_SCIENCE } = QUESTION_PAPER_EXAMPLES;

const DETAILS = { schoolName: 'Question Paper School', className: 'Class 8', subjectName: 'Science', examName: 'Unit Test 1', maxMarks: 25 };

describe('quick papers in a school', () => {
  let world: QuestionPaperWorld;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
  });

  it('creates a quick paper in a session that prints with the school template, its details in the heading', async () => {
    const { teacher } = world.people;
    const { schoolId } = world;
    const { paperId, reused } = await teacher.client.school.createStandalonePaper({ schoolId });
    expect(reused).toBe(false);
    const [row] = await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.id, paperId));
    // It belongs to no session.
    expect(row).toMatchObject({ kind: 'standalone', printLayout: 'school_template', sessionId: null, examSlug: null, classId: null, createdBy: teacher.userId });

    // Before any detail is stated, the template's lines show placeholders for what the details will fill in.
    const empty = await teacher.client.school.getStandalonePaper({ schoolId, paperId });
    expect(empty.templatePrints?.above.join('\n')).toContain('[subject]');

    const saved = await teacher.client.school.saveStandalonePaperVersion({ schoolId, paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: DETAILS });
    expect(saved).toMatchObject({ versionNo: 1, hasPdf: true });
    const [version] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, paperId));
    expect(version).toMatchObject({ paperKind: 'standalone', paperPrintLayout: 'school_template' });
    expect(version!.templateRevisionId).not.toBeNull();

    const preview = await teacher.client.school.getStandalonePaperPreview({ schoolId, paperId, versionNo: 1 });
    expect(preview.templateName).not.toBeNull();
    expect(preview.html).not.toContain('class="qp-standalone"');
    for (const text of ['Question Paper School', 'Class 8', 'Science', 'Unit Test 1', '25', '2026']) expect(preview.html).toContain(text);
    // Once stated, the details replace the placeholders in what the template prints.
    const read = await teacher.client.school.getStandalonePaper({ schoolId, paperId });
    expect(read.templatePrints?.above.join('\n')).not.toContain('[subject]');
    expect(read.paper).toMatchObject({ printLayout: 'school_template', details: DETAILS });

    const draft = await teacher.client.school.previewStandalonePaperDraft({ schoolId, paperId, html: ENGLISH_SCIENCE });
    expect(draft.problems).toEqual([]);
    expect(draft.templateName).not.toBeNull();

    // Each version keeps the heading it printed: a later save's details never change an earlier version's print.
    // The heading printed the school's active session, kept with the version.
    expect(version!.printedDetails).toEqual({ className: 'Class 8', subjectName: 'Science', examName: 'Unit Test 1', maxMarks: 25, sessionStartYear: 2026, sessionEndYear: 2027 });
    await teacher.client.school.saveStandalonePaperVersion({
      schoolId,
      paperId,
      expectedVersionNo: 1,
      html: ENGLISH_SCIENCE,
      details: { ...DETAILS, className: 'Class 9', examName: 'Unit Test 2', maxMarks: 30 },
    });
    const first = await teacher.client.school.getStandalonePaperPreview({ schoolId, paperId, versionNo: 1 });
    expect(first.html).toContain('Unit Test 1');
    expect(first.html).not.toContain('Unit Test 2');
    const second = await teacher.client.school.getStandalonePaperPreview({ schoolId, paperId, versionNo: 2 });
    expect(second.html).toContain('Unit Test 2');
  });

  it("reaches only the creator's papers, unless the role oversees every one", async () => {
    const { teacher, otherTeacher, principal, coordinator, manager } = world.people;
    const { schoolId } = world;
    const { paperId } = await teacher.client.school.createStandalonePaper({ schoolId });
    await teacher.client.school.reserveStandalonePaperPages({ schoolId, paperId, fileNames: ['page.jpg'] });

    // Another teacher: the paper is not found, for reads and changes, and not listed.
    await expect(otherTeacher.client.school.getStandalonePaper({ schoolId, paperId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(otherTeacher.client.school.deleteStandalonePaper({ schoolId, paperId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const listed = await otherTeacher.client.school.listStandalonePapers({ schoolId });
    expect(listed.items.map((item) => item.paperId)).not.toContain(paperId);

    // The school-wide roles oversee it.
    for (const person of [principal, coordinator, manager]) {
      await expect(person.client.school.getStandalonePaper({ schoolId, paperId })).resolves.toMatchObject({ paper: { paperId } });
    }
  });

  it('never hands one person an empty paper another person created', async () => {
    const { teacher, otherTeacher } = world.people;
    const { schoolId } = world;
    const mine = await teacher.client.school.createStandalonePaper({ schoolId });
    const theirs = await otherTeacher.client.school.createStandalonePaper({ schoolId });
    expect(theirs.paperId).not.toBe(mine.paperId);
    await expect(teacher.client.school.createStandalonePaper({ schoolId })).resolves.toEqual({ paperId: mine.paperId, reused: true });
  });

  it('refuses the accountant, and everyone while the school has no assistant', async () => {
    const { accountant, teacher } = world.people;
    await expectPermissionDenied(accountant.client.school.listStandalonePapers({ schoolId: world.schoolId }));
    await expectPermissionDenied(accountant.client.school.createStandalonePaper({ schoolId: world.schoolId }));
    await setTestSchoolFeature(world.schoolId, 'assistant', false);
    try {
      await expectFeatureDisabled(teacher.client.school.listStandalonePapers({ schoolId: world.schoolId }), 'assistant');
      await expectFeatureDisabled(teacher.client.school.createStandalonePaper({ schoolId: world.schoolId }), 'assistant');
      await expectFeatureDisabled(teacher.client.school.listSchoolQuestionPapers({ schoolId: world.schoolId, sessionId: world.sessionId }), 'assistant');
    } finally {
      await setTestSchoolFeature(world.schoolId, 'assistant', true);
    }
  });

  it('has none of a personal space limits: more papers and versions than a space may hold', async () => {
    const { teacher } = world.people;
    const { schoolId } = world;
    await db.insert(examQuestionPaperTable).values(
      Array.from({ length: STANDALONE_PAPERS_PER_SPACE_LIMIT }, () => ({
        schoolId,
        kind: 'standalone' as const,
        printLayout: 'school_template' as const,
        latestVersionNo: 1,
        createdBy: teacher.userId,
      })),
    );
    const { paperId } = await teacher.client.school.createStandalonePaper({ schoolId });
    await db.update(examQuestionPaperTable).set({ latestVersionNo: STANDALONE_PAPER_MAX_VERSIONS }).where(eq(examQuestionPaperTable.id, paperId));
    await expect(
      teacher.client.school.saveStandalonePaperVersion({ schoolId, paperId, expectedVersionNo: STANDALONE_PAPER_MAX_VERSIONS, html: ENGLISH_SCIENCE, details: DETAILS }),
    ).resolves.toMatchObject({ versionNo: STANDALONE_PAPER_MAX_VERSIONS + 1 });
  });
});

describe('quick papers need an active session to print', () => {
  it("refuses a save and a generation while the school has no active session, whose years the heading prints", async () => {
    const world = await createQuestionPaperWorld();
    const { teacher } = world.people;
    const { schoolId } = world;
    const { paperId } = await teacher.client.school.createStandalonePaper({ schoolId });
    await db.update(schoolSessionTable).set({ isActive: false }).where(eq(schoolSessionTable.id, world.sessionId));
    // Reading still works; what the template prints is not known yet.
    await expect(teacher.client.school.getStandalonePaper({ schoolId, paperId })).resolves.toMatchObject({ templatePrints: null });
    await expect(
      teacher.client.school.saveStandalonePaperVersion({ schoolId, paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: DETAILS }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', data: { reason: QUICK_PAPER_NO_ACTIVE_SESSION_REASON } });
  });
});

describe('quick papers need a template to print', () => {
  it('refuses a save and a generation while the school has no question paper template', async () => {
    const world = await createQuestionPaperWorld({ template: false });
    const { teacher } = world.people;
    const { schoolId } = world;
    const { paperId } = await teacher.client.school.createStandalonePaper({ schoolId });
    const detail = await teacher.client.school.getStandalonePaperDetail({ schoolId, paperId });
    expect(detail.templateConfigured).toBe(false);
    await expect(
      teacher.client.school.saveStandalonePaperVersion({ schoolId, paperId, expectedVersionNo: 0, html: ENGLISH_SCIENCE, details: DETAILS }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
