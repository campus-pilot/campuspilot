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
/**
 * An upload that finds the user at the unsent cap first deletes that user's
 * unsent attachments older than this (images left behind by a reload or a
 * closed tab), then counts again; if the user is still at the cap it deletes
 * the oldest unsent images beyond the newest {@link ASSISTANT_ATTACHMENTS_PER_MESSAGE}
 * (a composer holds at most that many, so the rest were left by a composer that
 * unmounted and are invisible to the user).
 */
export const ASSISTANT_UNSENT_ATTACHMENT_RECLAIM_HOURS = 1;
/**
 * Image bytes, as sent (base64, 4/3 of the file), one model request may carry:
 * the chat context and the question paper generation job share it. Providers
 * cap the whole request: Gemini's inline limit is 20 MB, Anthropic's 32 MB.
 * 16 MiB leaves the rest for the system prompt, tools and history.
 */
export const MODEL_REQUEST_IMAGE_BUDGET_BYTES = 16 * 1024 * 1024;
/** The size an image takes in a request: providers receive it base64 encoded. */
export const encodedImageBytes = (bytes: number) => Math.ceil((bytes * 4) / 3);
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
/**
 * A natural key part of the seed: Unicode letters, marks and digits plus
 * underscore, hyphen, dot and tilde, with no whitespace, control character,
 * angle bracket or quote. This is wider than ids on purpose: exam, subject and
 * mode slugs are free text in the school configuration (`maths.2`, a Hindi
 * name), and a link that silently loses its seed is worse than a wider
 * allowlist. The seed is written into the model's context, so what keeps free
 * text out of it is the send procedure, which resolves the key against the
 * school's own exam, class and plan rows (`resolvePaperScope`) before storing
 * anything; this pattern is only the first, cheap screen.
 */
const seedKeyPart = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\p{L}\p{M}\p{N}_.~-]+$/u, 'Only letters, digits, dots, hyphens, tildes and underscores are allowed.');
export const questionPaperSeedSchema = z.object({
  kind: z.literal('question_paper'),
  sessionId: seedKeyPart,
  examSlug: seedKeyPart,
  classId: seedKeyPart,
  subjectSlug: seedKeyPart,
  modeSlug: seedKeyPart,
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
/** `DELETE` here removes one image the user attached but has not sent yet. */
export const assistantAttachmentDeletePath = (schoolId: string, attachmentId: string) =>
  `${assistantAttachmentUploadPath(schoolId)}/${encodeURIComponent(attachmentId)}`;
export const assistantAttachmentReadPath = (schoolId: string, attachmentId: string, variant: 'thumb' | 'original') =>
  `${assistantAttachmentUploadPath(schoolId)}/${encodeURIComponent(attachmentId)}/${variant}`;
