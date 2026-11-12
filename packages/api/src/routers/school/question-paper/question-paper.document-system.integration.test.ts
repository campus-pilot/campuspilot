import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { examPlanTable } from '@campuspilot/db/schema/exam';
import { examQuestionPaperJobTable, examQuestionPaperTable, examQuestionPaperVersionTable } from '@campuspilot/db/schema/exam-question-paper';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { createSchoolStaffSession, createTestClient, createTestSchool, setTestSchoolFeature } from '../../../../test/fixtures';
import { createQuestionPaperWorld, switchAssistantRoles, type QuestionPaperWorld } from '../../../../test/question-paper';
import { DOCUMENT_CONTEXT_HELP, DOCUMENT_MARKETPLACE } from '../document/document.catalog';
import { resolvePaperScope } from './question-paper.scope';
import { QUESTION_PAPER_SLOT_MESSAGE } from './question-paper.slot';
import { renderStoredVersionHtml } from './question-paper.version.service';

const ENGLISH_SCIENCE = QUESTION_PAPER_EXAMPLES['english-science'];
const CUSTOM = '<header style="direction:{{questionPaper.direction}}"><h1>CUSTOM HEADER {{exam.name}}</h1></header>{{{questionPaper.bodyHtml}}}<footer style="position:fixed;bottom:0;left:0;right:0">CUSTOM FOOTER</footer>';

/** The `question_paper` document type through the document system's template and history procedures. */
describe('question paper in the document system', () => {
  let world: QuestionPaperWorld;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
  });
  const scope = () => ({ schoolId: world.schoolId, documentType: 'question_paper' as const });

  describe('the template belongs to the assistant feature', () => {
    it('is unavailable to a school without the feature, after the permission check', async () => {
      const school = await createTestSchool({});
      const manager = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'manager' }])).session);
      const teacher = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }])).session);
      const s = { schoolId: school.id, documentType: 'question_paper' as const };
      for (const call of [
        () => manager.school.listMarketplaceTemplates(s),
        () => manager.school.getMarketplaceTemplate({ ...s, slug: 'question-paper-classic' }),
        () => manager.school.getActiveDocumentTemplate(s),
        () => manager.school.previewDocumentTemplate({ ...s, content: CUSTOM, pageSize: 'full' }),
        () => manager.school.selectMarketplaceTemplate({ ...s, slug: 'question-paper-classic', expectedRevisionId: null }),
        () => manager.school.saveDocumentTemplate({ ...s, name: 'Custom', content: CUSTOM, expectedRevisionId: null }),
      ]) await expectFeatureDisabled(call(), 'assistant');
      // A teacher cannot manage templates at all: a plain denial that does not reveal the feature.
      await expectPermissionDenied(teacher.school.saveDocumentTemplate({ ...s, name: 'Custom', content: CUSTOM, expectedRevisionId: null }));
    });

    it('needs the feature only, not the caller\'s own assistant role', async () => {
      await switchAssistantRoles(world.schoolId, ['teacher']);
      try {
        // The principal's role is not switched on for the assistant, yet they configure the school's template.
        const active = await world.people.principal.client.school.getActiveDocumentTemplate(scope());
        expect(active?.artifact.documentType).toBe('question_paper');
        await expect(world.people.principal.client.school.getQuestionPaper(world.key())).rejects.toMatchObject({ data: { reason: 'role_not_enabled' } });
      } finally {
        await switchAssistantRoles(world.schoolId, ['principal', 'manager', 'teacher', 'exam_coordinator']);
      }
    });
  });

  describe('templates', () => {
    it('lists both designs and previews each with the example paper in its slot', async () => {
      const list = await world.people.teacher.client.school.listMarketplaceTemplates(scope());
      const designs = DOCUMENT_MARKETPLACE.filter((design) => design.documentType === 'question_paper');
      expect(list.items.map((item) => item.slug).sort()).toEqual(designs.map((design) => design.slug).sort());
      expect(list.items.every((item) => item.pageSize === 'full')).toBe(true);
      for (const design of designs) {
        const item = await world.people.teacher.client.school.getMarketplaceTemplate({ ...scope(), slug: design.slug });
        expect(item.html, design.slug).toContain('Which gas is released during photosynthesis?');
        expect(item.html, design.slug).toContain('Greenwood Public School');
        expect(item.contextHelp).toBe(DOCUMENT_CONTEXT_HELP);
        expect(item.contextHelp).toContain('position:fixed; bottom:0');
      }
    });

    it('previews an unsaved template, and refuses one that does not place the body exactly once', async () => {
      const preview = await world.people.manager.client.school.previewDocumentTemplate({ ...scope(), content: CUSTOM, pageSize: 'full' });
      expect(preview.html).toContain('CUSTOM HEADER Half Yearly Examination');
      expect(preview.html).toContain('Which gas is released during photosynthesis?');
      await expect(world.people.manager.client.school.previewDocumentTemplate({ ...scope(), content: '<p>no body</p>', pageSize: 'full' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: QUESTION_PAPER_SLOT_MESSAGE });
    });

    it('validates a template when it is saved: the slot, the budget, full A4 only', async () => {
      const save = (overrides: Record<string, unknown>) =>
        world.people.manager.client.school.saveDocumentTemplate({ ...scope(), name: 'Custom', content: CUSTOM, pageSize: 'full', expectedRevisionId: null, ...overrides } as never);
      await expect(save({ content: '<p>no body</p>' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: QUESTION_PAPER_SLOT_MESSAGE });
      await expect(save({ content: '{{{questionPaper.bodyHtml}}}{{{questionPaper.bodyHtml}}}' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: QUESTION_PAPER_SLOT_MESSAGE });
      await expect(save({ content: '{{log "x"}}{{{questionPaper.bodyHtml}}}' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const half = (await save({ pageSize: 'half' }).then(() => null, (error: unknown) => error)) as { code: string; data: unknown } | null;
      expect(half).toMatchObject({ code: 'BAD_REQUEST' });
      expect(JSON.stringify(half!.data)).toContain('Question papers print on full A4');
    });

    it('prints a version with the template selected when it was saved and pins that revision', async () => {
      const manager = world.people.manager.client.school;
      const k = world.key({ subjectSlug: 'math', modeSlug: 'practical' });
      const v1 = await manager.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: ENGLISH_SCIENCE });
      const classicRevision = (await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, v1.paperId)))[0]!.templateRevisionId;

      const current = await manager.getActiveDocumentTemplate(scope());
      const custom = await manager.saveDocumentTemplate({ ...scope(), name: 'Custom paper', content: CUSTOM, pageSize: 'full', expectedRevisionId: current!.artifact.id });
      const v2 = await manager.saveQuestionPaperVersion({ ...k, expectedVersionNo: 1, html: ENGLISH_SCIENCE });
      const versions = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, v2.paperId));
      expect(versions.sort((a, b) => a.versionNo - b.versionNo).map((version) => version.templateRevisionId)).toEqual([classicRevision, custom.artifact.id]);

      expect((await manager.getQuestionPaperPreview({ ...k, versionNo: 2 })).html).toContain('CUSTOM HEADER Term I Examination');
      const old = await manager.getQuestionPaperPreview({ ...k, versionNo: 1 });
      expect(old.html).not.toContain('CUSTOM HEADER');
      expect(old.templateName).not.toBe('Custom paper');

      // A draft previews with the template selected now.
      const draft = await manager.previewQuestionPaperDraft({ ...k, html: ENGLISH_SCIENCE });
      expect(draft).toMatchObject({ problems: [], templateName: 'Custom paper' });
      expect(draft.html).toContain('CUSTOM FOOTER');
      const invalid = await manager.previewQuestionPaperDraft({ ...k, html: '<p></p>' });
      expect(invalid.html).toBe('');
      expect(invalid.problems.length).toBeGreaterThan(0);
    });

    it('keeps the maximum marks a version was saved with when the plan changes later (preview and restored PDF)', async () => {
      const own = await createQuestionPaperWorld();
      const manager = own.people.manager.client.school;
      const ownScope = { schoolId: own.schoolId, documentType: 'question_paper' as const };
      const current = await manager.getActiveDocumentTemplate(ownScope);
      await manager.saveDocumentTemplate({ ...ownScope, name: 'Marks paper', content: '<h1>OUT OF {{questionPaper.maxMarks}}</h1>{{{questionPaper.bodyHtml}}}', pageSize: 'full', expectedRevisionId: current!.artifact.id });
      const k = own.key();
      const v1 = await manager.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: ENGLISH_SCIENCE });
      expect(v1.planMaxMarks).toBe(20);
      await db
        .update(examPlanTable)
        .set({ modeConfig: { theory: { percentage: 100, maxMarks: 100 } }, totalMarks: 100 })
        .where(and(eq(examPlanTable.sessionId, own.sessionId), eq(examPlanTable.classId, own.classId), eq(examPlanTable.subjectSlug, 'science')));
      expect((await manager.getQuestionPaperPreview({ ...k, versionNo: 1 })).html).toContain('OUT OF 20');
      // A draft is judged against the plan as it is now.
      expect((await manager.previewQuestionPaperDraft({ ...k, html: ENGLISH_SCIENCE })).html).toContain('OUT OF 100');

      const [row] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, v1.paperId));
      await db.delete(artifactTable).where(eq(artifactTable.id, row!.pdfArtifactId!));
      const { url } = await manager.getQuestionPaperDownload({ ...k, versionNo: 1 });
      expect((await fetch(url)).status).toBe(200);
      const { html } = await renderStoredVersionHtml(db, await resolvePaperScope(db, k), (await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.id, row!.id)))[0]!);
      expect(html).toContain('OUT OF 20');
    });

    it('restores a deleted PDF from the fragment and the pinned template when it is downloaded', async () => {
      const manager = world.people.manager.client.school;
      const k = world.key({ subjectSlug: 'math', modeSlug: 'practical' });
      const [version] = await db
        .select()
        .from(examQuestionPaperVersionTable)
        .innerJoin(artifactTable, eq(artifactTable.id, examQuestionPaperVersionTable.pdfArtifactId))
        .where(and(eq(artifactTable.schoolId, world.schoolId), eq(artifactTable.name, 'Question paper: Mathematics (Practical) - Class 8 - v1')));
      const original = version!.exam_question_paper_version;
      await db.delete(artifactTable).where(eq(artifactTable.id, original.pdfArtifactId!));
      expect((await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.id, original.id)))[0]!.pdfArtifactId).toBeNull();
      expect((await manager.listQuestionPaperVersions(k)).versions.find((v) => v.versionNo === 1)!.hasPdf).toBe(false);

      const { url, fileName } = await manager.getQuestionPaperDownload({ ...k, versionNo: 1 });
      expect(fileName).toBe('Question paper: Mathematics (Practical) - Class 8 - v1.pdf');
      expect((await fetch(url)).status).toBe(200);
      const restored = (await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.id, original.id)))[0]!;
      expect(restored.pdfArtifactId).not.toBeNull();
      expect(restored.templateRevisionId).toBe(original.templateRevisionId);
      expect((await manager.listQuestionPaperVersions(k)).versions.find((v) => v.versionNo === 1)!.hasPdf).toBe(true);
    });
  });

  describe('the generic document history', () => {
    it('never lists, downloads or deletes a question paper PDF: access is per class, history is per school', async () => {
      const k = world.key({ subjectSlug: 'math', modeSlug: 'practical' });
      const mine = await db
        .select()
        .from(artifactTable)
        .where(and(eq(artifactTable.schoolId, world.schoolId), eq(artifactTable.documentType, 'question_paper'), eq(artifactTable.kind, 'pdf')));
      expect(mine.length).toBeGreaterThan(0);

      const manager = world.people.manager.client.school;
      for (const filters of [{}, { documentType: 'question_paper' as const }, { documentDomain: 'all' as const }, { sessionId: world.sessionId, classId: k.classId }]) {
        const history = await manager.listDocumentArtifacts({ schoolId: world.schoolId, filters });
        expect(history.items.filter((item) => item.documentType === 'question_paper'), JSON.stringify(filters)).toEqual([]);
      }
      const artifact = mine[0]!;
      await expect(manager.getDocumentDownload({ schoolId: world.schoolId, artifactId: artifact.id, documentType: 'question_paper' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(manager.deleteDocumentArtifact({ schoolId: world.schoolId, artifactId: artifact.id, documentType: 'question_paper' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await db.select().from(artifactTable).where(eq(artifactTable.id, artifact.id))).toHaveLength(1);
    });

    it('answers a school without the feature the same way', async () => {
      await setTestSchoolFeature(world.schoolId, 'assistant', false);
      try {
        await expectFeatureDisabled(world.people.manager.client.school.getDocumentDownload({ schoolId: world.schoolId, artifactId: 'x', documentType: 'question_paper' }), 'assistant');
      } finally {
        await setTestSchoolFeature(world.schoolId, 'assistant', true);
      }
    });
  });

  describe('listQuestionPapers', () => {
    it('shows each person the classes they may read, with the state of every paper', async () => {
      const input = { schoolId: world.schoolId, sessionId: world.sessionId, examSlug: 'term-1' };
      const teacher = await world.people.teacher.client.school.listQuestionPapers(input);
      expect(teacher.classes.map((c) => [c.className, c.canManage])).toEqual([['Class 8', true]]);
      const coordinator = await world.people.coordinator.client.school.listQuestionPapers(input);
      expect(coordinator.classes.map((c) => [c.className, c.canManage])).toEqual([['Class 8', true], ['Class 9', true]]);
      const other = await world.people.otherTeacher.client.school.listQuestionPapers(input);
      expect(other.classes.map((c) => c.className)).toEqual(['Class 9']);
      expect((await world.people.otherTeacher.client.school.listQuestionPapers({ ...input, classId: world.classId })).classes).toEqual([]);
      await expect(world.people.accountant.client.school.listQuestionPapers(input)).rejects.toMatchObject({ code: 'FORBIDDEN', data: { reason: 'role_not_enabled' } });
      await expect(world.people.manager.client.school.listQuestionPapers({ ...input, examSlug: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const class8 = coordinator.classes[0]!;
      expect(class8.subjects.map((s) => [s.subjectSlug, s.subjectName, s.modes.map((m) => [m.modeSlug, m.modeName, m.maxMarks])])).toEqual([
        ['math', 'Mathematics', [['practical', 'Practical', 4], ['theory', 'Theory', 16]]],
        ['science', 'Science', [['theory', 'Theory', 20]]],
      ]);
      const practical = class8.subjects[0]!.modes[0]!.paper!;
      expect(practical).toMatchObject({ latestVersionNo: 2, planMaxMarks: 4, activeJob: null, lastJobFailure: null });
      expect(practical.warningCount).toBe(0);
      // Nothing was uploaded or saved for it yet.
      expect(class8.subjects[1]!.modes[0]!.paper).toBeNull();
    });

    it('shows a failed AI job only until a version is saved after it', async () => {
      const own = await createQuestionPaperWorld();
      const manager = own.people.manager.client.school;
      const input = { schoolId: own.schoolId, sessionId: own.sessionId, examSlug: 'term-1', classId: own.classId };
      const k = own.key();
      const saved = async () => (await manager.listQuestionPapers(input)).classes[0]!.subjects.find((subject) => subject.subjectSlug === 'science')!.modes[0]!.paper!;
      // A paper row with a failed job and no version yet.
      const [paper] = await db.insert(examQuestionPaperTable).values({ ...k, createdBy: own.people.manager.userId }).returning();
      await db.insert(examQuestionPaperJobTable).values({
        paperId: paper!.id, schoolId: own.schoolId, requestedBy: own.people.manager.userId, pageIds: [], pageRevision: 0,
        status: 'failed', errorCode: 'model_error', errorMessage: 'The AI service failed. Try again.', completedAt: new Date(Date.now() - 60_000),
      });
      expect((await saved()).lastJobFailure).toMatchObject({ errorCode: 'model_error' });
      await manager.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: ENGLISH_SCIENCE });
      expect((await saved()).lastJobFailure).toBeNull();
    });
  });
});
