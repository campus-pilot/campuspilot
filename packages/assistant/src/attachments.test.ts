import {
  ASSISTANT_ATTACHMENT_MAX_BYTES,
  ASSISTANT_ATTACHMENTS_PER_MESSAGE,
  assistantAttachmentReadPath,
  assistantAttachmentUploadPath,
  assistantMessageSeedSchema,
  parseQuestionPaperSeedParams,
  QUESTION_PAPER_SEED_DRAFT,
} from '@campuspilot/assistant-contract/attachments';
import { assistantCardOf } from '@campuspilot/assistant-contract/protocol';
import { sendAssistantMessageInputSchema } from '@campuspilot/assistant-contract/dto';
import { assistantViewSchema } from '@campuspilot/assistant-contract/views';
import { describe, expect, it } from 'vitest';

import { sanitizeAttachmentName, unreadableAttachmentMessage } from './attachments';
import { imageMimeTypesOf } from './runtime/providers/image-types';

const base = { schoolId: 's1', clientRequestId: '7b0d3b63-8f4b-4a9c-9f4a-2f4a0d6a7a11', surface: 'page' as const };
const ids = (count: number) => Array.from({ length: count }, (_, index) => `asat_${index}`);

describe('chat attachment limits', () => {
  it('allows 20 images of 15 MB per message', () => {
    expect(ASSISTANT_ATTACHMENTS_PER_MESSAGE).toBe(20);
    expect(ASSISTANT_ATTACHMENT_MAX_BYTES).toBe(15 * 1024 * 1024);
    expect(sendAssistantMessageInputSchema.safeParse({ ...base, text: 'see', attachmentIds: ids(20) }).success).toBe(true);
    expect(sendAssistantMessageInputSchema.safeParse({ ...base, text: 'see', attachmentIds: ids(21) }).success).toBe(false);
  });

  it('needs words or an image, and each image once', () => {
    expect(sendAssistantMessageInputSchema.safeParse({ ...base, text: '   ' }).success).toBe(false);
    expect(sendAssistantMessageInputSchema.safeParse({ ...base, text: '' , attachmentIds: ids(1) }).success).toBe(true);
    expect(sendAssistantMessageInputSchema.safeParse({ ...base, text: 'x' }).success).toBe(true);
    expect(sendAssistantMessageInputSchema.safeParse({ ...base, text: 'x', attachmentIds: ['asat_1', 'asat_1'] }).success).toBe(false);
    // Existing callers send no ids: they default to none.
    expect(sendAssistantMessageInputSchema.parse({ ...base, text: 'x' }).attachmentIds).toEqual([]);
  });

  it('accepts a seed only when a conversation starts', () => {
    const seed = { kind: 'question_paper', sessionId: 'a', examSlug: 'b', classId: 'c', subjectSlug: 'd', modeSlug: 'e' } as const;
    expect(sendAssistantMessageInputSchema.safeParse({ ...base, text: 'x', seed }).success).toBe(true);
    expect(sendAssistantMessageInputSchema.safeParse({ ...base, text: 'x', seed, conversationId: 'asc_1' }).success).toBe(false);
    expect(assistantMessageSeedSchema.safeParse({ ...seed, modeSlug: '' }).success).toBe(false);
    expect(assistantMessageSeedSchema.safeParse({ ...seed, kind: 'other' }).success).toBe(false);
  });

  it('has stable routes for the upload and the thumbnail', () => {
    expect(assistantAttachmentUploadPath('s 1')).toBe('/api/blob/schools/s%201/assistant/attachments');
    expect(assistantAttachmentReadPath('s1', 'asat_1', 'thumb')).toBe('/api/blob/schools/s1/assistant/attachments/asat_1/thumb');
  });
});

describe('question paper in the chat contract', () => {
  it('has a question_paper view with a version number', () => {
    const view = { type: 'question_paper', sessionId: 's', examSlug: 'e', classId: 'c', subjectSlug: 'su', modeSlug: 'm', versionNo: 2 };
    expect(assistantViewSchema.safeParse(view).success).toBe(true);
    expect(assistantViewSchema.safeParse({ ...view, versionNo: 0 }).success).toBe(false);
  });

  it('renders only the draft check as a card', () => {
    expect(assistantCardOf('school.validateQuestionPaperDraft')).toBe('question_paper_draft');
    expect(assistantCardOf('school.saveQuestionPaperVersion')).toBeNull();
  });
});

describe('D46: a type the provider cannot read is refused with a clear message', () => {
  const heic = { originalName: 'IMG_0042.HEIC', contentType: 'image/heic', derivativeStatus: 'unsupported' as const };
  it('refuses HEIC on Claude, never silently', () => {
    expect(unreadableAttachmentMessage([heic], imageMimeTypesOf('anthropic'))).toBe(
      "IMG_0042.HEIC can't be read by the assistant. Convert it to JPEG and attach it again.",
    );
  });
  it('accepts HEIC on Gemini and any image the server decoded', () => {
    expect(unreadableAttachmentMessage([heic], imageMimeTypesOf('gemini'))).toBeNull();
    expect(unreadableAttachmentMessage([{ ...heic, derivativeStatus: 'ready' }], imageMimeTypesOf('anthropic'))).toBeNull();
  });
});

describe('attachment file names', () => {
  it('drop paths and control characters and stay short', () => {
    expect(sanitizeAttachmentName('C:\\Users\\a\\page 1.jpg')).toBe('page 1.jpg');
    expect(sanitizeAttachmentName('../../etc/pa\u0000ss<wd>.png')).toBe('pa_ss_wd_.png');
    expect(sanitizeAttachmentName('')).toBe('image');
    expect(sanitizeAttachmentName('x'.repeat(300))).toHaveLength(120);
  });
});

describe('Continue in chat link contract', () => {
  const query = { seed: 'question_paper', sessionId: 'ss1', examSlug: 'half-yearly', classId: 'cl1', subjectSlug: 'science', modeSlug: 'theory' };

  it('reads the seed from the address the question paper screen links to', () => {
    expect(parseQuestionPaperSeedParams(query)).toEqual({ kind: 'question_paper', ...Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'seed')) });
    // The first value wins when a parameter is repeated.
    expect(parseQuestionPaperSeedParams({ ...query, classId: ['cl1', 'cl2'] })?.classId).toBe('cl1');
  });

  it('starts a plain conversation for anything missing, empty or unknown', () => {
    expect(parseQuestionPaperSeedParams({})).toBeNull();
    expect(parseQuestionPaperSeedParams({ ...query, seed: 'something_else' })).toBeNull();
    expect(parseQuestionPaperSeedParams({ ...query, modeSlug: undefined })).toBeNull();
    expect(parseQuestionPaperSeedParams({ ...query, examSlug: '  ' })).toBeNull();
  });

  it('starts the box with the sentence the user finishes', () => {
    expect(QUESTION_PAPER_SEED_DRAFT).toBe('I want to update this question paper: ');
  });
});
