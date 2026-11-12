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
import { putObject } from './question-paper.storage';

const ENGLISH_SCIENCE = QUESTION_PAPER_EXAMPLES[1];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
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

  /** An attachment row with its object, sent (bound to a message) unless `sent` is false. */
  async function attachment(options: { userId?: string; sent?: boolean; heic?: boolean } = {}) {
    const id = generateId('assistantAttachment');
    const userId = options.userId ?? world.people.manager.userId;
    const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const key = `schools/${world.schoolId}/assistant/attachments/${id}/original.jpg`;
    await putObject(key, bytes, 'image/jpeg');
    let binding: Partial<typeof assistantAttachmentTable.$inferInsert> = {};
    if (options.sent !== false) {
      position += 1;
      const [item] = await db
        .insert(assistantItemTable)
        .values({ conversationId, runId, kind: 'user_message', status: 'complete', position, sequence: position, itemKey: `item-${crypto.randomUUID()}`, body: { text: 'figure' } })
        .returning();
      binding = { conversationId, itemId: item!.id, position: 1, attachedAt: new Date() };
    }
    await db.insert(assistantAttachmentTable).values({
      id,
      schoolId: world.schoolId,
      userId,
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

  const withFigure = (imageId: string) => {
    const content = clone(ENGLISH_SCIENCE) as Record<string, any>;
    content.sections[0].questions[0].blocks = [{ type: 'figure', imageId, alt: 'The diagram' }];
    return content;
  };

  it('accepts an attachment the user sent as a figure of a draft, in the assistant only', async () => {
    const id = await attachment();
    const k = world.key({ classId: world.otherClassId });
    expect(await agent().school.validateQuestionPaperDraft({ ...k, content: withFigure(id) })).toMatchObject({ valid: true, errors: [] });
    // A person using the API directly (or an external client) has no chat, so no attachments.
    const outside = await world.people.manager.client.school.validateQuestionPaperDraft({ ...k, content: withFigure(id) });
    expect(outside.valid).toBe(false);
    expect(outside.errors[0]!.message).toMatch(/inside the in-app assistant/);
  });

  it('refuses an attachment of another user, an unsent one and one the server could not decode', async () => {
    const k = world.key({ classId: world.otherClassId });
    const theirs = await attachment({ userId: world.people.teacher.userId });
    const unsent = await attachment({ sent: false });
    const heic = await attachment({ heic: true });
    expect((await agent().school.validateQuestionPaperDraft({ ...k, content: withFigure(theirs) })).errors[0]!.message).toMatch(/not an image the user attached/);
    expect((await agent().school.validateQuestionPaperDraft({ ...k, content: withFigure(unsent) })).errors[0]!.message).toMatch(/not an image the user attached/);
    expect((await agent().school.validateQuestionPaperDraft({ ...k, content: withFigure(heic) })).errors[0]!.message).toMatch(/cannot be printed/);
    expect((await agent().school.validateQuestionPaperDraft({ ...k, content: withFigure('asat_nonexistent00000000') })).valid).toBe(false);
  });

  it('copies the attachment into the paper on save, stores the version with the figure id, and reuses it on the next save', async () => {
    const id = await attachment();
    const k = world.key({ classId: world.otherClassId, subjectSlug: 'math' });
    const first = await agent().school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, content: withFigure(id) });
    expect(first.versionNo).toBe(1);

    const figures = await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.paperId, first.paperId));
    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({ sourceAttachmentId: id, createdBy: world.people.manager.userId });
    expect(figures[0]!.id.startsWith('qpf_')).toBe(true);

    const [version] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, first.paperId));
    const stored = JSON.stringify(version!.content);
    expect(stored).toContain(figures[0]!.id);
    expect(stored).not.toContain('asat_');

    // The same attachment in the next version is the same figure, not a second copy.
    const second = await agent().school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 1, content: withFigure(id) });
    expect(second.versionNo).toBe(2);
    expect(await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.paperId, first.paperId))).toHaveLength(1);

    // The saved version prints without any chat attachment.
    const preview = await world.people.manager.client.school.getQuestionPaperPreview({ ...k, versionNo: 1 });
    expect(preview.html).toContain('data:image/jpeg;base64,');
  });

  it('refuses to save an attachment outside the assistant, and one that is not the saver\'s', async () => {
    const id = await attachment();
    const k = world.key({ classId: world.otherClassId, subjectSlug: 'science' });
    const outside = await errorOf(world.people.manager.client.school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, content: withFigure(id) }));
    expect(outside).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('in-app assistant') });
    const theirs = await attachment({ userId: world.people.teacher.userId });
    const crossed = await errorOf(agent().school.saveQuestionPaperVersion({ ...k, expectedVersionNo: 0, content: withFigure(theirs) }));
    expect(crossed).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('previews a draft with the owner\'s attachment inline, and not for anyone else', async () => {
    const id = await attachment();
    const k = world.key({ classId: world.otherClassId, subjectSlug: 'math', modeSlug: 'practical' });
    const preview = await world.people.manager.client.school.previewQuestionPaperDraft({ ...k, content: withFigure(id) });
    expect(preview.errors).toEqual([]);
    expect(preview.html).toContain('data:image/jpeg;base64,');
    const other = await world.people.principal.client.school.previewQuestionPaperDraft({ ...k, content: withFigure(id) });
    expect(other.html).toBe('');
    expect(other.errors[0]!.message).toMatch(/not an image the user attached/);
  });
});
