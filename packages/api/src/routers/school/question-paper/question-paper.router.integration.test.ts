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

const { 'hindi-maths': HINDI_MATH, 'english-science': ENGLISH_SCIENCE } = QUESTION_PAPER_EXAMPLES;

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
      await expectPermissionDenied(world.people.otherTeacher.client.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, html: ENGLISH_SCIENCE }));
      await expectPermissionDenied(world.people.otherTeacher.client.school.validateQuestionPaperDraft({ ...key(), html: ENGLISH_SCIENCE }));
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
        await expectFeatureDisabled(teacher.school.validateQuestionPaperDraft({ ...key(), html: ENGLISH_SCIENCE }), 'assistant');
        await expectFeatureDisabled(world.people.manager.client.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, html: ENGLISH_SCIENCE }), 'assistant');
        await expectFeatureDisabled(world.people.manager.client.school.listQuestionPapers({ schoolId: world.schoolId, sessionId: world.sessionId, examSlug: 'term-1' }), 'assistant');
      } finally {
        await setTestSchoolFeature(world.schoolId, 'assistant', true);
      }
      await expect(teacher.school.getQuestionPaper(key())).resolves.toBeDefined();
    });
  });

  describe('learn_question_paper_generation', () => {
    it('returns the guide, the limits and one example to roles that may use the assistant', async () => {
      const learn = await teacher.school.learn_question_paper_generation({ schoolId: world.schoolId });
      expect(learn.guide).toContain('Writing a question paper');
      expect(learn.guide.indexOf('NO ANIMATION')).toBeGreaterThan(-1);
      expect(learn.example).toContain('data-math');
      expect(learn.limits).toMatchObject({ fragmentChars: 80_000 });
      expect(learn).not.toHaveProperty('jsonSchema');
      // The whole payload must fit what the assistant may read of it (design G6).
      expect(JSON.stringify(learn).length).toBeLessThan(QUESTION_PAPER_LEARN_OUTPUT_CHARS);
    });

    it('refuses an accountant (not switched on) and a stranger', async () => {
      expect(await errorOf(world.people.accountant.client.school.learn_question_paper_generation({ schoolId: world.schoolId }))).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'role_not_enabled' } });
    });
  });

  describe('validateQuestionPaperDraft', () => {
    it('accepts a valid paper without saving anything, with a stable draft id', async () => {
      const first = await teacher.school.validateQuestionPaperDraft({ ...key(), html: ENGLISH_SCIENCE });
      expect(first).toMatchObject({ valid: true, problems: [], stripped: [], placeholderFigures: 1 });
      expect(first.draftId).toMatch(/^[0-9a-f]{12}$/);
      expect((await teacher.school.validateQuestionPaperDraft({ ...key(), html: ENGLISH_SCIENCE })).draftId).toBe(first.draftId);
      expect((await teacher.school.getQuestionPaper(key())).paper.paperId).toBeNull();
    });

    it('does not mind the marks: a Hindi paper out of 15 for a mode out of 20 is simply valid', async () => {
      expect(await teacher.school.validateQuestionPaperDraft({ ...key(), html: HINDI_MATH })).toMatchObject({ valid: true, problems: [], stripped: [] });
    });

    it('tells what the sanitiser removed, without refusing the paper', async () => {
      const hostile = `${ENGLISH_SCIENCE}<script>alert(1)</script><p onclick="x()" style="animation:spin 1s;color:red">x</p><svg viewBox="0 0 1 1"><circle r="1"><animate attributeName="r" dur="1s"/></circle></svg>`;
      const checked = await teacher.school.validateQuestionPaperDraft({ ...key(), html: hostile });
      expect(checked).toMatchObject({ valid: true, problems: [] });
      const notes = checked.stripped.join('\n');
      expect(notes).toContain('<script> was removed');
      expect(notes).toContain('event handler "onclick"');
      expect(notes).toContain('"animation"');
      expect(notes).toContain('<animate>');
    });

    it('reports an empty paper, a formula KaTeX rejects and an unusable figure id as problems', async () => {
      expect((await teacher.school.validateQuestionPaperDraft({ ...key(), html: '<p> </p>' })).problems).toEqual(['The paper is empty. Write the questions as HTML.']);

      const mathErrors = await teacher.school.validateQuestionPaperDraft({ ...key(), html: '<p>Bad <span data-math="\\frac{1"></span></p>' });
      expect(mathErrors.valid).toBe(false);
      expect(mathErrors.problems).toEqual([expect.stringMatching(/^Formula 1 \(\\frac\{1\): Invalid TeX/)]);

      const qpf = 'qpf_aaaaaaaaaaaaaaaaaaaaa';
      expect((await teacher.school.validateQuestionPaperDraft({ ...key(), html: `<img data-figure-id="${qpf}" alt="x">` })).problems).toEqual([
        `Figure ${qpf}: This figure image does not belong to this paper. Use the asat_ id of an attachment of this chat, a qpf_ id from getQuestionPaper, or <figure data-placeholder="..."></figure>.`,
      ]);
      const asat = 'asat_aaaaaaaaaaaaaaaaaaaaa';
      expect((await teacher.school.validateQuestionPaperDraft({ ...key(), html: `<img data-figure-id="${asat}" alt="x">` })).problems[0]).toMatch(/not an image the user attached/);
    });

    it('accepts the heaviest formula paper the fragment limit allows (its KaTeX output stays under the body cap)', async () => {
      // One nested \\sqrt of 491 characters is about 72 KB of KaTeX HTML. At 80,000 characters of fragment
      // at most ~150 of them fit, about 11 MB: under the body cap, so whatever validates also prints.
      const tex = '\\sqrt{'.repeat(70) + 'x' + '}'.repeat(70);
      const heavy = `<p>${Array.from({ length: 150 }, () => `<span data-math="${tex}"></span>`).join(' ')}</p>`;
      const checked = await teacher.school.validateQuestionPaperDraft({ ...key(), html: heavy });
      expect(checked.problems).toEqual([]);
      expect(checked.valid).toBe(true);
    });

    it('answers a paper between the product limit and the parse limit with a problem', async () => {
      // 100,000 characters: over fragmentChars (80,000), under parseChars (120,000), so it is parsed and the size is reported.
      const large = `<p>${'x'.repeat(100_000)}</p>`;
      const result = await teacher.school.validateQuestionPaperDraft({ ...key(), html: large });
      expect(result.valid).toBe(false);
      expect(result.problems[0]).toMatch(/characters after cleaning; the limit is 80,000/);
    });

    it('refuses a paper over the parse limit at the transport, before anything is parsed', async () => {
      const huge = `<p>${'x'.repeat(120_001)}</p>`;
      const error = await errorOf(teacher.school.validateQuestionPaperDraft({ ...key(), html: huge }));
      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('refuses a key that names no plan or mode', async () => {
      expect(await errorOf(teacher.school.validateQuestionPaperDraft({ ...key({ modeSlug: 'practical' }), html: ENGLISH_SCIENCE }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('no "practical" mode') });
      expect(await errorOf(teacher.school.validateQuestionPaperDraft({ ...key({ subjectSlug: 'art' }), html: ENGLISH_SCIENCE }))).toMatchObject({ code: 'NOT_FOUND' });
      expect(await errorOf(teacher.school.validateQuestionPaperDraft({ ...key(), examSlug: 'nope', html: ENGLISH_SCIENCE }))).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('saveQuestionPaperVersion', () => {
    it('saves versions in order, prints a real PDF and refuses a stale expectedVersionNo', async () => {
      const first = await teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, html: ENGLISH_SCIENCE });
      expect(first).toMatchObject({ versionNo: 1, planMaxMarks: 20, hasPdf: true, warnings: [] });

      const stale = await errorOf(teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 0, html: ENGLISH_SCIENCE }));
      expect(stale).toMatchObject({ code: 'CONFLICT' });
      expect(stale!.message).toContain('latest version is 1');

      const second = await world.people.manager.client.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 1, html: HINDI_MATH });
      expect(second.versionNo).toBe(2);

      const latest = await teacher.school.getQuestionPaper(key());
      expect(latest.paper).toMatchObject({ latestVersionNo: 2 });
      expect(latest.version).toMatchObject({ versionNo: 2, source: 'agent', isLatest: true, hasPdf: true, createdBy: { id: world.people.manager.userId } });
      expect(latest.version!.html).toContain('<div lang="hi">');
      expect(latest.version!.html).toContain('data-math="2x+3=11"');
      const older = await teacher.school.getQuestionPaper({ ...key(), versionNo: 1 });
      expect(older.version).toMatchObject({ versionNo: 1, isLatest: false });
      expect(await errorOf(teacher.school.getQuestionPaper({ ...key(), versionNo: 9 }))).toMatchObject({ code: 'NOT_FOUND' });

      const { versions } = await teacher.school.listQuestionPaperVersions(key());
      expect(versions.map((version) => [version.versionNo, version.isLatest, version.hasPdf, version.warningCount])).toEqual([[2, true, true, 0], [1, false, true, 0]]);
    });

    it('stores a downloadable A4 PDF whose pages follow the questions', async () => {
      const { url, fileName } = await teacher.school.getQuestionPaperDownload({ ...key(), versionNo: 1 });
      expect(fileName).toBe('Science_Class 8_Theory_v1.pdf');
      const pdf = await pdfOf(url);
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
      const { width, height } = pdf.getPage(0).getSize();
      expect(Math.round(width)).toBe(595);
      expect(Math.round(height)).toBe(842);
    });

    it('flows a long paper over several pages', async () => {
      const filler = Array.from({ length: 70 }, (_, index) => `<div class="q"><span class="no">${index + 10}</span><div class="main">Question number ${index + 10}: explain in two or three sentences how the process of evaporation differs from boiling and give one everyday example of each.</div><span class="marks">[0.25]</span></div>`).join('');
      const long = `${ENGLISH_SCIENCE}<h2 class="sec">Section Z</h2>${filler}`;
      const saved = await world.people.manager.client.school.saveQuestionPaperVersion({ ...key({ subjectSlug: 'math' }), expectedVersionNo: 0, html: long });
      const { url } = await teacher.school.getQuestionPaperDownload({ ...key({ subjectSlug: 'math' }), versionNo: saved.versionNo });
      expect((await pdfOf(url)).getPageCount()).toBeGreaterThanOrEqual(3);
    });

    it('lets exactly one of two concurrent saves with the same expectedVersionNo win', async () => {
      const k = key({ subjectSlug: 'math', modeSlug: 'practical' });
      const results = await Promise.allSettled([
        teacher.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: ENGLISH_SCIENCE }),
        world.people.manager.client.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: HINDI_MATH }),
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

    it('refuses an invalid paper, listing the problems, and saves nothing', async () => {
      const k = key({ classId: world.otherClassId, subjectSlug: 'science' });
      const error = await errorOf(world.people.manager.client.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: '<p>Bad <span data-math="\\frac{1"></span></p>' }));
      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(error!.message).toContain('Formula 1');
      expect((await world.people.otherTeacher.client.school.getQuestionPaper(k)).paper.latestVersionNo).toBe(0);
    });

    it('saves what the sanitiser keeps, stores it cleaned and records what it removed as notices', async () => {
      const k = key({ classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'practical' });
      const hostile = `<script>alert(1)</script><p onclick="x()" style="transition:all 1s">Safe question</p><style>@keyframes a{from{opacity:0}}</style>`;
      const saved = await world.people.manager.client.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: hostile });
      expect(saved.warnings.map((warning) => warning.code)).toEqual(['sanitised', 'sanitised', 'sanitised', 'sanitised']);
      const [row] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, saved.paperId));
      expect(row!.contentHtml).toBe('<p>Safe question</p>');
      expect(row!.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.warnings.map((warning) => warning.message).join('\n')).toContain('@keyframes');
    });

    it('needs exactly one of html and draftId, and a draftId only from the in-app assistant', async () => {
      const both = await errorOf(teacher.school.saveQuestionPaperVersion({ ...key(), expectedVersionNo: 2, html: ENGLISH_SCIENCE, draftId: 'aaaaaaaaaaaa' }));
      expect(both).toMatchObject({ code: 'BAD_REQUEST', message: 'Send exactly one of html or draftId, not both.' });
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
      const draft = ENGLISH_SCIENCE;
      const { draftId } = await world.people.manager.client.school.validateQuestionPaperDraft({ ...k, html: draft });
      const agent = assistantClient('manager', ids);

      // Not validated in this conversation yet.
      expect(await errorOf(agent.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('No draft') });

      await recordToolCall(ids, 'school_validateQuestionPaperDraft', { ...k, html: draft });
      const saved = await agent.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, draftId: draftId! });
      expect(saved).toMatchObject({ versionNo: 1, planMaxMarks: 20 });
      const [row] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, saved.paperId));
      expect(row).toMatchObject({ source: 'agent', sourceConversationId: ids.conversation.id, sourceJobId: null, createdBy: world.people.manager.userId });
    });

    it('reads an unsaved draft back by draftId (the way back after the chat stubbed its html), only in this conversation and only for the in-app assistant', async () => {
      const k = key({ classId: world.otherClassId, subjectSlug: 'math' });
      const ids = await conversationOf(world.people.manager.userId);
      const { draftId } = await world.people.manager.client.school.validateQuestionPaperDraft({ ...k, html: ENGLISH_SCIENCE });
      const agent = assistantClient('manager', ids);
      expect(await errorOf(agent.school.getQuestionPaperDraft({ ...k, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('No draft') });

      await recordToolCall(ids, 'school_validateQuestionPaperDraft', { ...k, html: ENGLISH_SCIENCE });
      const draft = await agent.school.getQuestionPaperDraft({ ...k, draftId: draftId! });
      expect(draft).toMatchObject({ draftId, paper: { subjectName: expect.any(String) } });
      expect(draft.html).toContain('data-math');
      expect(draft.characters).toBe(draft.html.length);
      // Reading changes nothing, and the same draftId then saves.
      expect((await world.people.manager.client.school.getQuestionPaper({ ...k })).paper.latestVersionNo).toBe(draft.paper.latestVersionNo);
      expect(await agent.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: draft.paper.latestVersionNo, draftId: draftId! })).toMatchObject({ versionNo: draft.paper.latestVersionNo + 1 });

      // A browser session, an API key or any client without a chat is refused, as for a draftId on save.
      expect(await errorOf(world.people.manager.client.school.getQuestionPaperDraft({ ...k, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('in-app assistant') });
      // Another conversation of the same user does not see it.
      const other = await conversationOf(world.people.manager.userId);
      expect(await errorOf(assistantClient('manager', other).school.getQuestionPaperDraft({ ...k, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('No draft') });
    });

    it('does not find a draft of another conversation, another user\'s conversation or a deleted one', async () => {
      const k = key({ classId: world.otherClassId, subjectSlug: 'math' });
      const draft = ENGLISH_SCIENCE;
      const { draftId } = await world.people.manager.client.school.validateQuestionPaperDraft({ ...k, html: draft });
      const mine = await conversationOf(world.people.manager.userId);
      const other = await conversationOf(world.people.manager.userId);
      await recordToolCall(other, 'school_validateQuestionPaperDraft', { ...k, html: draft });
      expect(await errorOf(assistantClient('manager', mine).school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, draftId: draftId! }))).toMatchObject({ code: 'BAD_REQUEST' });

      const theirs = await conversationOf(world.people.teacher.userId);
      await recordToolCall(theirs, 'school_validateQuestionPaperDraft', { ...k, html: draft });
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
