import { z } from 'zod';

/**
 * Images a user attaches to a chat message (design G1, decisions D30/D38).
 * Bytes never travel through a message or a transcript: a message carries
 * attachment ids, and the files live in object storage (`assistant_attachment`).
 */

/** Files one message may carry. */
export const ASSISTANT_ATTACHMENTS_PER_MESSAGE = 20;
/** The largest file one attachment may be. */
export const ASSISTANT_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
/** Uploaded but not yet sent attachments a user may hold in one school. */
export const ASSISTANT_UNSENT_ATTACHMENTS_PER_USER = 40;
/** Hours an attachment that was never sent is kept before the sweep deletes it. */
export const ASSISTANT_UNSENT_ATTACHMENT_TTL_HOURS = 24;
/** The multipart field of the upload route (one file per request). */
export const ASSISTANT_ATTACHMENT_FIELD_NAME = 'file';
/** Media types the picker offers; the server decides with the file's bytes. */
export const ASSISTANT_ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

/** What the message and the composer know about one attachment (no bytes, no URLs). */
export const assistantAttachmentRefSchema = z.object({
  /** `asat_...` */
  id: z.string().min(1),
  fileName: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** False when the server could not decode the file (HEIC): it has no thumbnail. */
  previewable: z.boolean(),
});
export type AssistantAttachmentRef = z.infer<typeof assistantAttachmentRefSchema>;

/**
 * Where a conversation starts from, when the user came from a screen
 * ("Continue in chat" on a question paper, D31). Natural keys only: no
 * personal data, and permission is decided by the tools when they are used.
 */
export const questionPaperSeedSchema = z.object({
  kind: z.literal('question_paper'),
  sessionId: z.string().trim().min(1).max(120),
  examSlug: z.string().trim().min(1).max(120),
  classId: z.string().trim().min(1).max(120),
  subjectSlug: z.string().trim().min(1).max(120),
  modeSlug: z.string().trim().min(1).max(120),
});
export const assistantMessageSeedSchema = z.discriminatedUnion('kind', [questionPaperSeedSchema]);
export type AssistantMessageSeed = z.infer<typeof assistantMessageSeedSchema>;
export type QuestionPaperSeed = z.infer<typeof questionPaperSeedSchema>;

/**
 * Reads the seed from a page's query string (`?seed=question_paper&sessionId=
 * &examSlug=&classId=&subjectSlug=&modeSlug=`, the contract of "Continue in
 * chat"). Anything missing, empty or malformed means no seed: a plain new
 * conversation. Repeated parameters use the first value.
 */
export function parseQuestionPaperSeedParams(
  query: Readonly<Record<string, string | string[] | undefined>>,
): QuestionPaperSeed | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const parsed = questionPaperSeedSchema.safeParse({
    kind: first(query.seed),
    sessionId: first(query.sessionId),
    examSlug: first(query.examSlug),
    classId: first(query.classId),
    subjectSlug: first(query.subjectSlug),
    modeSlug: first(query.modeSlug),
  });
  return parsed.success ? parsed.data : null;
}

/** The text the composer starts with when a question paper seed is used. */
export const QUESTION_PAPER_SEED_DRAFT = 'I want to update this question paper: ';

/** The one `/blob` style path of an attachment, relative to the API origin. */
export const assistantAttachmentUploadPath = (schoolId: string) =>
  `/api/blob/schools/${encodeURIComponent(schoolId)}/assistant/attachments`;
export const assistantAttachmentReadPath = (schoolId: string, attachmentId: string, variant: 'thumb' | 'original') =>
  `${assistantAttachmentUploadPath(schoolId)}/${encodeURIComponent(attachmentId)}/${variant}`;
