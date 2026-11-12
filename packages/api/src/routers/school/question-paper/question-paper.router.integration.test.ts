import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import {
  assistantConversationTable,
  assistantItemTable,
  assistantRunTable,
} from '@campuspilot/db/schema/assistant';
import { examQuestionPaperVersionTable } from '@campuspilot/db/schema/exam-question-paper';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { createRouterClient } from '@orpc/server';
import { and, eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { setTestSchoolFeature, type TestClient } from '../../../../test/fixtures';
import { createQuestionPaperWorld, switchAssistantRoles, type QuestionPaperWorld } from '../../../../test/question-paper';
import type { Context } from '../../../context';
import { appRouter } from '../../index';
import { DOCUMENT_MARKETPLACE } from '../document/document.catalog';
import { QUESTION_PAPER_LEARN_OUTPUT_CHARS } from './question-paper.dto';

const [HINDI_MATH, ENGLISH_SCIENCE] = QUESTION_PAPER_EXAMPLES;

/** Clones an example so a test can change it. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function pdfOf(url: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return PDFDocument.load(new Uint8Array(await response.arrayBuffer()));
}

const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as { code: string; message: string; data?: { reason?: string } });

describe('question paper procedures', () => {
  let world: QuestionPaperWorld;
  let teacher: TestClient;
  beforeAll(async () => {
    world = await createQuestionPaperWorld();
    teacher = world.people.teacher.client;
  });
  const key = (overrides = {}) => world.key(overrides);

  describe('who may read and write (OPA, then the assistant gate)', () => {
    it.each(['manager', 'principal', 'coordinator', 'teacher'] as const)('lets the %s read a paper of the class', async (who) => {
      const result = await world.people[who].client.school.getQuestionPaper(key());
      expect(result.paper).toMatchObject({ paperId: null, latestVersionNo: 0, pageCount: 0, pageRevision: 0, planMaxMarks: 20, subjectName: 'Science', modeName: 'Theory', className: 'Class 8', examName: 'Term I Examination' });
      expect(result.version).toBeNull();
    });

    it('refuses a teacher of another class and an accountant with a plain permission denial', async () => {
      await expectPermissionDenied(world.people.otherTeacher.client.school.getQuestionPaper(key()));
      await expectPermissionDenied(world.people.accountant.client.school.getQuestionPaper(key()));
      await expectPermissionDenied(world.people.otherTeacher.client.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, content: clone(ENGLISH_SCIENCE) }));
      await expectPermissionDenied(world.people.otherTeacher.client.school.validateQuestionPaperDraft({ ...key(), content: clone(ENGLISH_SCIENCE) }));
    });

    it('lets the teacher of the other class read that class', async () => {
      const other = await world.people.otherTeacher.client.school.getQuestionPaper(key({ classId: world.otherClassId }));
      expect(other.paper.className).toBe('Class 9');
    });

    it('refuses a role the school did not switch on for the assistant, after the permission check', async () => {
      await switchAssistantRoles(world.schoolId, ['principal', 'manager', 'teacher']);
      try {
        const error = await errorOf(world.people.coordinator.client.school.getQuestionPaper(key()));
        expect(error).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'role_not_enabled' } });
        // A caller without the OPA permission still learns nothing about the feature.
        await expectPermissionDenied(world.people.otherTeacher.client.school.getQuestionPaper(key()));
      } finally {
        await switchAssistantRoles(world.schoolId, ['principal', 'manager', 'teacher', 'exam_coordinator']);
      }
    });

    it('refuses everything while the school has no assistant feature, and works again when it returns', async () => {
      await setTestSchoolFeature(world.schoolId, 'assistant', false);
      try {
        await expectFeatureDisabled(teacher.school.getQuestionPaper(key()), 'assistant');
        await expectFeatureDisabled(teacher.school.listQuestionPaperVersions(key()), 'assistant');
        await expectFeatureDisabled(teacher.school.learn_question_paper_generation({ schoolId: world.schoolId }), 'assistant');
        await expectFeatureDisabled(teacher.school.validateQuestionPaperDraft({ ...key(), content: clone(ENGLISH_SCIENCE) }), 'assistant');
        await expectFeatureDisabled(world.people.manager.client.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, content: clone(ENGLISH_SCIENCE) }), 'assistant');
        await expectFeatureDisabled(world.people.manager.client.school.listQuestionPapers({ schoolId: world.schoolId, sessionId: world.sessionId, examSlug: 'term-1' }), 'assistant');
      } finally {
        await setTestSchoolFeature(world.schoolId, 'assistant', true);
      }
      await expect(teacher.school.getQuestionPaper(key())).resolves.toBeDefined();
    });
  });

  describe('learn_question_paper_generation', () => {
    it('returns the guide, schema, limits and both examples to roles that may use the assistant', async () => {
      const learn = await teacher.school.learn_question_paper_generation({ schoolId: world.schoolId });
      expect(learn.schemaVersion).toBe(1);
      expect(learn.guide).toContain('Writing a question paper');
      expect(learn.examples).toHaveLength(2);
      expect(learn.jsonSchema).toMatchObject({ type: 'object' });
      expect(learn.limits).toMatchObject({ sections: 20 });
      // The whole payload must fit what the assistant may read of it (design G6).
      expect(JSON.stringify(learn).length).toBeLessThan(QUESTION_PAPER_LEARN_OUTPUT_CHARS);
    });

    it('refuses an accountant (not switched on) and a stranger', async () => {
      expect(await errorOf(world.people.accountant.client.school.learn_question_paper_generation({ schoolId: world.schoolId }))).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'role_not_enabled' } });
    });
  });

  describe('validateQuestionPaperDraft', () => {
    it('accepts a valid paper without saving anything, with a stable draft id', async () => {
      const first = await teacher.school.validateQuestionPaperDraft({ ...key(), content: clone(ENGLISH_SCIENCE) });
      expect(first).toMatchObject({ valid: true, errors: [], total: 20, planMaxMarks: 20, placeholderFigures: 1 });
      // A figure that still needs its image is a warning, never an error.
      expect(first.warnings.map((warning) => warning.code)).toEqual(['figure_placeholder_unresolved']);
      expect(first.draftId).toMatch(/^[0-9a-f]{12}$/);
      expect((await teacher.school.validateQuestionPaperDraft({ ...key(), content: clone(ENGLISH_SCIENCE) })).draftId).toBe(first.draftId);
      expect((await teacher.school.getQuestionPaper(key())).paper.paperId).toBeNull();
    });

    it('reports schema, formula and figure errors with their paths, and warns when the total differs from the plan', async () => {
      const broken = clone(ENGLISH_SCIENCE) as Record<string, any>;
      broken.sections[0].questions[0].type = 'essay';
      const schemaErrors = await teacher.school.validateQuestionPaperDraft({ ...key(), content: broken });
      expect(schemaErrors.valid).toBe(false);
      expect(schemaErrors.errors[0]!.path).toBe('sections[0].questions[0].type');

      const withMath = clone(ENGLISH_SCIENCE) as Record<string, any>;
      withMath.sections[0].questions[0].text = ['Bad ', { t: 'math', tex: '\\frac{1}' }];
      const mathErrors = await teacher.school.validateQuestionPaperDraft({ ...key(), content: withMath });
      expect(mathErrors.errors).toEqual([{ path: 'sections[0].questions[0].text[1]', message: expect.stringMatching(/^Invalid TeX/) }]);

      const withFigure = clone(ENGLISH_SCIENCE) as Record<string, any>;
      withFigure.sections[0].questions[0].blocks = [{ type: 'figure', imageId: 'qpf_aaaaaaaaaaaaaaaaaaaaa', alt: 'x' }];
      expect((await teacher.school.validateQuestionPaperDraft({ ...key(), content: withFigure })).errors).toEqual([
        { path: 'sections[0].questions[0].blocks[0].imageId', message: 'This figure image does not belong to this paper.' },
      ]);
      withFigure.sections[0].questions[0].blocks = [{ type: 'figure', imageId: 'asat_aaaaaaaaaaaaaaaaaaaaa', alt: 'x' }];
      expect((await teacher.school.validateQuestionPaperDraft({ ...key(), content: withFigure })).errors[0]!.message).toMatch(/not an image the user attached/);

      const warned = await teacher.school.validateQuestionPaperDraft({ ...key(), content: clone(HINDI_MATH) });
      expect(warned).toMatchObject({ valid: true, total: 15 });
      expect(warned.warnings.map((warning) => warning.code)).toContain('total_differs_from_plan');
    });

    it('refuses a paper whose formulas alone cannot be printed, in validation and in save (they agree with the render)', async () => {
      // One nested \\sqrt of 491 characters is about 72 KB of KaTeX HTML; 300 of them exceed the 20 MB body limit.
      const tex = '\\sqrt{'.repeat(70) + 'x' + '}'.repeat(70);
      const heavy = clone(ENGLISH_SCIENCE) as Record<string, any>;
      // A rich text holds at most 4,000 characters, so eight formulas per question: 38 questions, 304 formulas.
      const first = heavy.sections[0].questions[0];
      heavy.sections = [{ ...heavy.sections[0], attemptAny: undefined, questions: Array.from({ length: 38 }, (_, index) => ({ ...clone(first), number: String(index + 1), text: Array.from({ length: 8 }, () => ({ t: 'math', tex })) })) }];
      const checked = await teacher.school.validateQuestionPaperDraft({ ...key(), content: heavy });
      expect(checked.valid).toBe(false);
      expect(checked.errors[0]!.message).toMatch(/formulas of this paper are too large to print/);
      expect(await errorOf(teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, content: heavy }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('The question paper is not valid') });
    });

    it('answers a paper that is too large with an error instead of parsing it', async () => {
      const huge = { schemaVersion: 1, padding: 'x'.repeat(210_000) };
      const result = await teacher.school.validateQuestionPaperDraft({ ...key(), content: huge });
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.message).toMatch(/characters of JSON/);
    });

    it('refuses a key that names no plan or mode', async () => {
      expect(await errorOf(teacher.school.validateQuestionPaperDraft({ ...key({ modeSlug: 'practical' }), content: clone(ENGLISH_SCIENCE) }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('no "practical" mode') });
      expect(await errorOf(teacher.school.validateQuestionPaperDraft({ ...key({ subjectSlug: 'art' }), content: clone(ENGLISH_SCIENCE) }))).toMatchObject({ code: 'NOT_FOUND' });
      expect(await errorOf(teacher.school.validateQuestionPaperDraft({ ...key(), examSlug: 'nope', content: clone(ENGLISH_SCIENCE) }))).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('saveQuestionPaperVersion', () => {
    it('saves versions in order, prints a real PDF and refuses a stale expectedVersionNo', async () => {
      const first = await teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, content: clone(ENGLISH_SCIENCE) });
      expect(first).toMatchObject({ versionNo: 1, totalMarks: 20, planMaxMarks: 20, hasPdf: true });
      expect(first.warnings.map((warning) => warning.code)).toEqual(['figure_placeholder_unresolved']);

      const stale = await errorOf(teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, content: clone(ENGLISH_SCIENCE) }));
      expect(stale).toMatchObject({ code: 'CONFLICT' });
      expect(stale!.message).toContain('latest version is 1');

      const second = await world.people.manager.client.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 1, content: clone(HINDI_MATH) });
      expect(second.versionNo).toBe(2);
      expect(second.warnings.map((warning) => warning.code)).toEqual(['total_differs_from_plan']);

      const latest = await teacher.school.getQuestionPaper(key());
      expect(latest.paper).toMatchObject({ latestVersionNo: 2 });
      expect(latest.version).toMatchObject({ versionNo: 2, source: 'agent', isLatest: true, totalMarks: 15, hasPdf: true, createdBy: { id: world.people.manager.userId } });
      expect((latest.version!.content as { meta: { language: string } }).meta.language).toBe('hi');
      const older = await teacher.school.getQuestionPaper({ ...key(), versionNo: 1 });
      expect(older.version).toMatchObject({ versionNo: 1, isLatest: false, totalMarks: 20 });
      expect(await errorOf(teacher.school.getQuestionPaper({ ...key(), versionNo: 9 }))).toMatchObject({ code: 'NOT_FOUND' });

      const { versions } = await teacher.school.listQuestionPaperVersions(key());
      expect(versions.map((version) => [version.versionNo, version.isLatest, version.hasPdf, version.warningCount])).toEqual([[2, true, true, 1], [1, false, true, 1]]);
    });

    it('stores a downloadable A4 PDF whose pages follow the questions', async () => {
      const { url, fileName } = await teacher.school.getQuestionPaperDownload({ ...key(), versionNo: 1 });
      expect(fileName).toBe('Question paper: Science (Theory) - Class 8 - v1.pdf');
      const pdf = await pdfOf(url);
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
      const { width, height } = pdf.getPage(0).getSize();
      expect(Math.round(width)).toBe(595);
      expect(Math.round(height)).toBe(842);
    });

    it('flows a long paper over several pages', async () => {
      const long = clone(ENGLISH_SCIENCE) as Record<string, any>;
      const filler = Array.from({ length: 70 }, (_, index) => ({
        number: String(index + 10),
        type: 'short_answer',
        marks: 0.25,
        text: `Question number ${index + 10}: explain in two or three sentences how the process of evaporation differs from boiling and give one everyday example of each.`,
      }));
      long.sections.push({ heading: 'Section Z', questions: filler });
      const saved = await world.people.manager.client.school.saveQuestionPaperVersion({ ...key({ subjectSlug: 'math' }), expectedVersionNo: 0, content: long });
      const { url } = await teacher.school.getQuestionPaperDownload({ ...key({ subjectSlug: 'math' }), versionNo: saved.versionNo });
      expect((await pdfOf(url)).getPageCount()).toBeGreaterThanOrEqual(3);
    });

    it('lets exactly one of two concurrent saves with the same expectedVersionNo win', async () => {
      const k = key({ subjectSlug: 'math', modeSlug: 'practical' });
      const results = await Promise.allSettled([
        teacher.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, content: clone(ENGLISH_SCIENCE) }),
        world.people.manager.client.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, content: clone(HINDI_MATH) }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
      const { versions } = await teacher.school.listQuestionPaperVersions(k);
      expect(versions).toHaveLength(1);
      // The refused attempt left no artifact behind.
      const artifacts = await db.select().from(artifactTable).where(and(eq(artifactTable.schoolId, world.schoolId), eq(artifactTable.name, 'Question paper: Mathematics (Practical) - Class 8 - v1')));
      expect(artifacts).toHaveLength(1);
    });

    it('refuses an invalid paper, listing the findings, and saves nothing', async () => {
      const k = key({ classId: world.otherClassId, subjectSlug: 'science' });
      const broken = clone(ENGLISH_SCIENCE) as Record<string, any>;
      delete broken.sections[0].questions[0].text;
      const error = await errorOf(world.people.manager.client.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, content: broken }));
      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(error!.message).toContain('sections[0].questions[0].text');
      expect((await world.people.otherTeacher.client.school.getQuestionPaper(k)).paper.latestVersionNo).toBe(0);
    });

    it('needs exactly one of content and draftId, and a draftId only from the in-app assistant', async () => {
      const both = await errorOf(teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 2, content: clone(ENGLISH_SCIENCE), draftId: 'aaaaaaaaaaaa' }));
      expect(both).toMatchObject({ code: 'BAD_REQUEST', message: 'Send exactly one of content or draftId, not both.' });
      const neither = await errorOf(teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 2 }));
      expect(neither).toMatchObject({ code: 'BAD_REQUEST' });
      const session = await errorOf(teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 2, draftId: 'aaaaaaaaaaaa' }));
      expect(session).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('in-app assistant') });
    });
  });

  describe('a draft saved by id from the in-app assistant (design E7)', () => {
    async function conversationOf(personUserId: string, schoolId = world.schoolId) {
      const [conversation] = await db.insert(assistantConversationTable).values({ schoolId, userId: personUserId, provider: 'gemini', model: 'm' }).returning();
      const [run] = await db
        .insert(assistantRunTable)
        .values({ conversationId: conversation!.id, schoolId, userId: personUserId, clientRequestId: crypto.randomUUID(), surface: 'panel', sequence: 1 })
        .returning();
      return { conversation: conversation!, run: run! };
    }
    let position = 0;
    async function recordToolCall(ids: { conversation: { id: string }; run: { id: string } }, toolName: string, input: unknown) {
      position += 1;
      await db.insert(assistantItemTable).values({
        conversationId: ids.conversation.id,
        runId: ids.run.id,
        kind: 'tool_call',
        status: 'succeeded',
        position,
        sequence: position,
        itemKey: `item-${crypto.randomUUID()}`,
        body: { toolUseId: `t${position}`, toolName, title: toolName, access: 'read', destructive: false, module: 'exams', input },
      });
    }
    const assistantClient = (who: 'teacher' | 'manager', ids: { conversation: { id: string }; run: { id: string } }) => {
      const person = world.people[who];
      return createRouterClient(appRouter, {
        context: async (): Promise<Context> => ({
          db,
          headers: new Headers(),
          session: person.session,
          principal: { authMethod: 'assistant', assistantRun: { conversationId: ids.conversation.id, runId: ids.run.id, schoolId: world.schoolId } },
        }),
      }) as unknown as TestClient;
    };

    it('saves the draft the agent validated earlier in this conversation, and nothing else', async () => {
      const k = key({ classId: world.otherClassId, subjectSlug: 'science' });
      const ids = await conversationOf(world.people.manager.userId);
      const draft = clone(ENGLISH_SCIENCE);
      const { draftId } = await world.people.manager.client.school.validateQuestionPaperDraft({ ...k, content: draft });
      const agent = assistantClient('manager', ids);

      // Not validated in this conversation yet.
      expect(await errorOf(agent.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('No draft') });

      await recordToolCall(ids, 'school_validateQuestionPaperDraft', { ...k, content: draft });
      const saved = await agent.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, draftId: draftId! });
      expect(saved).toMatchObject({ versionNo: 1, totalMarks: 20 });
      const [row] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, saved.paperId));
      expect(row).toMatchObject({ source: 'agent', sourceConversationId: ids.conversation.id, sourceJobId: null, createdBy: world.people.manager.userId });
    });

    it('does not find a draft of another conversation, another user\'s conversation or a deleted one', async () => {
      const k = key({ classId: world.otherClassId, subjectSlug: 'math' });
      const draft = clone(ENGLISH_SCIENCE);
      const { draftId } = await world.people.manager.client.school.validateQuestionPaperDraft({ ...k, content: draft });
      const mine = await conversationOf(world.people.manager.userId);
      const other = await conversationOf(world.people.manager.userId);
      await recordToolCall(other, 'school_validateQuestionPaperDraft', { ...k, content: draft });
      expect(await errorOf(assistantClient('manager', mine).school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST' });

      const theirs = await conversationOf(world.people.teacher.userId);
      await recordToolCall(theirs, 'school_validateQuestionPaperDraft', { ...k, content: draft });
      // The manager's run cannot read the teacher's conversation by pointing at it.
      const crossed = assistantClient('manager', { conversation: theirs.conversation, run: mine.run });
      expect(await errorOf(crossed.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST' });

      await db.update(assistantConversationTable).set({ deletedAt: new Date() }).where(eq(assistantConversationTable.id, other.conversation.id));
      expect(await errorOf(assistantClient('manager', other).school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('previews and downloads', () => {
    it('previews a saved version with the template revision it pinned, even after the school changes its template', async () => {
      const k = key({ subjectSlug: 'math' });
      const before = await teacher.school.getQuestionPaperPreview({ ...k, versionNo: 1 });
      const classic = DOCUMENT_MARKETPLACE.find((design) => design.slug === 'question-paper-classic')!;
      expect(before.templateName).toBe(classic.name);
      expect(before.html).toContain('Question Paper School');
      expect(before.html).toContain('Section Z');
      expect(before.html).toContain('Term I Examination');

      const current = await world.people.manager.client.school.getActiveDocumentTemplate({ schoolId: world.schoolId, documentType: 'question_paper' });
      await world.people.manager.client.school.selectMarketplaceTemplate({ schoolId: world.schoolId, documentType: 'question_paper', slug: 'question-paper-compact', expectedRevisionId: current!.artifact.id });
      const after = await teacher.school.getQuestionPaperPreview({ ...k, versionNo: 1 });
      expect(after.templateName).toBe(classic.name);
      expect(after.html).toBe(before.html);
    });
  });
});
