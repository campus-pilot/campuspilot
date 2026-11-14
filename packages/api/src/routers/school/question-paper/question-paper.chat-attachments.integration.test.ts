import { db } from '@campuspilot/db';
import { generateId } from '@campuspilot/db/id';
import {
  assistantAttachmentTable,
  assistantConversationTable,
  assistantItemTable,
  assistantRunTable,
} from '@campuspilot/db/schema/assistant';
import { examQuestionPaperFigureTable, examQuestionPaperVersionTable } from '@campuspilot/db/schema/exam-question-paper';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { type TestClient } from '../../../../test/fixtures';
import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../../test/question-paper';
import type { Context } from '../../../context';
import { appRouter } from '../../index';
import { questionPaperDraftId } from '@campuspilot/question-paper/hash';
import { putObject } from './question-paper.storage';

const ENGLISH_SCIENCE = QUESTION_PAPER_EXAMPLES['english-science'];
const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as { code: string; message: string });

/**
 * Chat attachments used as figures (design B6/E7): an `asat_` id is valid
 * only for the in-app assistant and only for an image the same user sent in a
 * chat message; saving copies it into the paper as a `qpf_` figure and stores
 * the version with the new id, once per attachment.
 */
describe('chat attachments as figures', () => {
  let world: QuestionPaperWorld;
  let conversationId: string;
  let runId: string;
  let position = 0;

  beforeAll(async () => {
    world = await createQuestionPaperWorld();
    const manager = world.people.manager.userId;
    const [conversation] = await db.insert(assistantConversationTable).values({ schoolId: world.schoolId, userId: manager, provider: 'gemini', model: 'm' }).returning();
    conversationId = conversation!.id;
    const [run] = await db
      .insert(assistantRunTable)
      .values({ conversationId, schoolId: world.schoolId, userId: manager, clientRequestId: crypto.randomUUID(), surface: 'panel', sequence: 1 })
      .returning();
    runId = run!.id;
  });

  /** A PDF the manager sent in a chat message (its object is the PDF itself; nothing is derived from it). */
  async function documentAttachment() {
    const id = generateId('assistantAttachment');
    const key = `schools/${world.schoolId}/assistant/attachments/${id}/original.pdf`;
    const bytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
    await putObject(key, bytes, 'application/pdf');
    position += 1;
    const [item] = await db
      .insert(assistantItemTable)
      .values({ conversationId, runId, kind: 'user_message', status: 'complete', position, sequence: position, itemKey: `item-${crypto.randomUUID()}`, body: { text: 'source' } })
      .returning();
    await db.insert(assistantAttachmentTable).values({
      id,
      schoolId: world.schoolId,
      userId: world.people.manager.userId,
      kind: 'document',
      originalName: 'old-paper.pdf',
      contentType: 'application/pdf',
      byteSize: bytes.byteLength,
      sha256: 'x',
      s3Key: key,
      derivativeStatus: null,
      conversationId,
      itemId: item!.id,
      position: 1,
      attachedAt: new Date(),
    });
    return id;
  }

  /** An attachment row with its object, sent (bound to a message, in the manager's chat unless `chat` says) unless `sent` is false. */
  async function attachment(options: { userId?: string; sent?: boolean; heic?: boolean; chat?: { conversationId: string; runId: string } } = {}) {
    const chat = options.chat ?? { conversationId, runId };
    const id = generateId('assistantAttachment');
    const userId = options.userId ?? world.people.manager.userId;
    const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const key = `schools/${world.schoolId}/assistant/attachments/${id}/original.jpg`;
    await putObject(key, bytes, 'image/jpeg');
    // The 1800 px model copy a decoded attachment has; figures and previews are made from it.
    if (!options.heic) await putObject(`${key}.model`, bytes, 'image/jpeg');
    let binding: Partial<typeof assistantAttachmentTable.$inferInsert> = {};
    if (options.sent !== false) {
      position += 1;
      const [item] = await db
        .insert(assistantItemTable)
        .values({ ...chat, kind: 'user_message', status: 'complete', position, sequence: position, itemKey: `item-${crypto.randomUUID()}`, body: { text: 'figure' } })
        .returning();
      binding = { conversationId: chat.conversationId, itemId: item!.id, position: 1, attachedAt: new Date() };
    }
    await db.insert(assistantAttachmentTable).values({
      id,
      schoolId: world.schoolId,
      userId,
      kind: 'image',
      originalName: 'diagram.jpg',
      contentType: options.heic ? 'image/heic' : 'image/jpeg',
      byteSize: bytes.byteLength,
      sha256: 'x',
      width: 120,
      height: 80,
      s3Key: key,
      derivativeStatus: options.heic ? 'unsupported' : 'ready',
      thumbS3Key: options.heic ? null : `${key}.thumb`,
      modelS3Key: options.heic ? null : `${key}.model`,
      modelContentType: options.heic ? null : 'image/jpeg',
      ...binding,
    });
    return id;
  }

  const agent = (who: 'manager' | 'teacher' = 'manager'): TestClient =>
    createRouterClient(appRouter, {
      context: async (): Promise<Context> => ({
        db,
        headers: new Headers(),
        session: world.people[who].session,
        principal: { authMethod: 'assistant', assistantRun: { conversationId, runId, schoolId: world.schoolId } },
      }),
    }) as unknown as TestClient;

  const withFigure = (imageId: string) =>
    ENGLISH_SCIENCE.replace('<h2 class="sec">Section A', `<figure><img data-figure-id="${imageId}" alt="The diagram"></figure><h2 class="sec">Section A`);

  it('accepts an attachment the user sent as a figure of a draft, in the assistant only', async () => {
    const id = await attachment();
    const k = world.key({ classId: world.otherClassId });
    expect(await agent().school.validateQuestionPaperDraft({ ...k, html: withFigure(id) })).toMatchObject({ valid: true, problems: [] });
    // The person's own browser session (the draft card's re-check) sees their attachments, like the preview does.
    expect(await world.people.manager.client.school.validateQuestionPaperDraft({ ...k, html: withFigure(id) })).toMatchObject({ valid: true, problems: [] });
    // Someone else's session does not: it is not their attachment.
    const other = await world.people.coordinator.client.school.validateQuestionPaperDraft({ ...k, html: withFigure(id) });
    expect(other.valid).toBe(false);
    expect(other.problems[0]).toMatch(/not an image the user attached/);
    // An API key or an external OAuth client has no chat at all, so no attachments.
    const external = createRouterClient(appRouter, {
      context: async (): Promise<Context> => ({
        db,
        headers: new Headers(),
        session: world.people.manager.session,
        principal: { authMethod: 'apiKey' },
      }),
    }) as unknown as TestClient;
    const outside = await external.school.validateQuestionPaperDraft({ ...k, html: withFigure(id) });
    expect(outside.valid).toBe(false);
    expect(outside.problems[0]).toMatch(/inside the in-app assistant/);
  });

  it('refuses an attachment of another user, an unsent one and one the server could not decode', async () => {
    const k = world.key({ classId: world.otherClassId });
    const theirs = await attachment({ userId: world.people.teacher.userId });
    const unsent = await attachment({ sent: false });
    const heic = await attachment({ heic: true });
    expect((await agent().school.validateQuestionPaperDraft({ ...k, html: withFigure(theirs) })).problems[0]).toMatch(/not an image the user attached/);
    expect((await agent().school.validateQuestionPaperDraft({ ...k, html: withFigure(unsent) })).problems[0]).toMatch(/not an image the user attached/);
    expect((await agent().school.validateQuestionPaperDraft({ ...k, html: withFigure(heic) })).problems[0]).toMatch(/cannot be printed/);
    expect((await agent().school.validateQuestionPaperDraft({ ...k, html: withFigure('asat_000000000000000000000') })).valid).toBe(false);
  });

  it('copies the attachment into the paper on save, stores the version with the figure id, and reuses it on the next save', async () => {
    const id = await attachment();
    const k = world.key({ classId: world.otherClassId, subjectSlug: 'math' });
    const first = await agent().school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: withFigure(id) });
    expect(first.versionNo).toBe(1);

    const figures = await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.paperId, first.paperId));
    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({ sourceAttachmentId: id, createdBy: world.people.manager.userId });
    expect(figures[0]!.id.startsWith('qpf_')).toBe(true);

    const [version] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, first.paperId));
    const stored = version!.contentHtml;
    expect(stored).toContain(figures[0]!.id);
    expect(stored).not.toContain('asat_');

    // The same attachment in the next version is the same figure, not a second copy.
    const second = await agent().school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 1, html: withFigure(id) });
    expect(second.versionNo).toBe(2);
    expect(await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.paperId, first.paperId))).toHaveLength(1);

    // The saved version prints without any chat attachment.
    const preview = await world.people.manager.client.school.getQuestionPaperPreview({ ...k, versionNo: 1 });
    expect(preview.html).toContain('data:image/jpeg;base64,');
  });

  it('refuses to save an attachment outside the assistant, and one that is not the saver\'s', async () => {
    const id = await attachment();
    const k = world.key({ classId: world.otherClassId, subjectSlug: 'science' });
    const outside = await errorOf(world.people.manager.client.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: withFigure(id) }));
    expect(outside).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('in-app assistant') });
    const theirs = await attachment({ userId: world.people.teacher.userId });
    const crossed = await errorOf(agent().school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: withFigure(theirs) }));
    expect(crossed).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('lets whoever works on a paper use the photos sent in a conversation shared with it, and only there', async () => {
    const k = world.key({ classId: world.otherClassId });
    const teacher = world.people.teacher.userId;
    const [shared] = await db
      .insert(assistantConversationTable)
      .values({
        schoolId: world.schoolId,
        userId: teacher,
        provider: 'gemini',
        model: 'm',
        paperSessionId: k.sessionId,
        paperExamSlug: k.examSlug,
        paperClassId: k.classId,
        paperSubjectSlug: k.subjectSlug,
        paperModeSlug: k.modeSlug,
      })
      .returning();
    const [sharedRun] = await db
      .insert(assistantRunTable)
      .values({ conversationId: shared!.id, schoolId: world.schoolId, userId: teacher, clientRequestId: crypto.randomUUID(), surface: 'panel', sequence: 1 })
      .returning();
    const photo = await attachment({ userId: teacher, chat: { conversationId: shared!.id, runId: sharedRun!.id } });

    // The manager's turn in the shared conversation uses the teacher's photo...
    const inShared = createRouterClient(appRouter, {
      context: async (): Promise<Context> => ({
        db,
        headers: new Headers(),
        session: world.people.manager.session,
        principal: { authMethod: 'assistant', assistantRun: { conversationId: shared!.id, runId: sharedRun!.id, schoolId: world.schoolId } },
      }),
    }) as unknown as TestClient;
    expect(await inShared.school.validateQuestionPaperDraft({ ...k, html: withFigure(photo) })).toMatchObject({ valid: true, problems: [] });
    // ...and so does the draft card of a colleague who opens that conversation.
    expect(await world.people.coordinator.client.school.validateQuestionPaperDraft({ ...k, html: withFigure(photo), conversationId: shared!.id })).toMatchObject({ valid: true });
    // Not from the manager's own private chat, and not for a paper the conversation is not shared with.
    expect((await agent().school.validateQuestionPaperDraft({ ...k, html: withFigure(photo) })).valid).toBe(false);
    const otherPaper = world.key({ classId: world.otherClassId, subjectSlug: 'math' });
    expect((await world.people.manager.client.school.validateQuestionPaperDraft({ ...otherPaper, html: withFigure(photo), conversationId: shared!.id })).valid).toBe(false);

    // A draft the teacher's turn validated there is read back by the manager's turn by its id, and saved by it.
    const html = ENGLISH_SCIENCE;
    position += 1;
    await db.insert(assistantItemTable).values({
      conversationId: shared!.id,
      runId: sharedRun!.id,
      kind: 'tool_call',
      status: 'succeeded',
      position,
      sequence: position,
      itemKey: `item-${crypto.randomUUID()}`,
      body: { toolUseId: 'tu_shared', toolName: 'school_validateQuestionPaperDraft', title: 'Validate', access: 'read', destructive: false, module: 'school', input: { ...k, html } },
    });
    const draftId = questionPaperDraftId(html);
    expect(await inShared.school.getQuestionPaperDraft({ ...k, draftId })).toMatchObject({ draftId });
    // The same id from the manager's private chat names nothing.
    expect(await errorOf(agent().school.getQuestionPaperDraft({ ...k, draftId }))).toMatchObject({ code: 'BAD_REQUEST' });

    // The paper's screen opens the conversation shared with it that changed last.
    const detail = await world.people.coordinator.client.school.getQuestionPaperDetail(k);
    expect(detail.latestConversationId).toBe(shared!.id);
  });

  it('refuses a PDF the user sent as a figure, with a problem that says to read it and use a placeholder', async () => {
    const id = await documentAttachment();
    const k = world.key({ classId: world.otherClassId, subjectSlug: 'science' });
    const checked = await agent().school.validateQuestionPaperDraft({ ...k, html: withFigure(id) });
    expect(checked.valid).toBe(false);
    expect(checked.problems[0]).toContain('old-paper.pdf is a PDF the user attached, not an image');
    expect(checked.problems[0]).toContain('data-placeholder');
    // A save refuses it too, and nothing is copied into the paper.
    const saved = await errorOf(agent().school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, html: withFigure(id) }));
    expect(saved).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.sourceAttachmentId, id))).toHaveLength(0);
    // Nor does a preview print it.
    const preview = await world.people.manager.client.school.previewQuestionPaperDraft({ ...k, html: withFigure(id) });
    expect(preview.html).toBe('');
    expect(preview.problems[0]).toContain('is a PDF the user attached');
  });

  it('previews a draft with the owner\'s attachment inline, and not for anyone else', async () => {
    const id = await attachment();
    const k = world.key({ classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'practical' });
    const preview = await world.people.manager.client.school.previewQuestionPaperDraft({ ...k, html: withFigure(id) });
    expect(preview.problems).toEqual([]);
    expect(preview.html).toContain('data:image/jpeg;base64,');
    const other = await world.people.principal.client.school.previewQuestionPaperDraft({ ...k, html: withFigure(id) });
    expect(other.html).toBe('');
    expect(other.problems[0]).toMatch(/not an image the user attached/);
  });
});
