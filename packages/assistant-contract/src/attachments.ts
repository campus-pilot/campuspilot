import { z } from 'zod';

/**
 * Files a user attaches to a chat message (design G1, decisions D30/D38):
 * images and PDF documents, the two kinds both model providers read natively.
 * Bytes never travel through a message or a transcript: a message carries
 * attachment ids, and the files live in object storage (`assistant_attachment`).
 *
 * Every number about attachments lives in this file (the server, the composer
 * and the model context all read it from here).
 */

/**
 * What an attachment is. Its own fact, stored in `assistant_attachment.kind`
 * and carried on every reference and transcript marker; it is decided once,
 * from the uploaded bytes ({@link sniffAttachmentKind} on the server), and is
 * never re-derived from a media type or a file name at the point of use.
 *
 * - `image`: JPEG, PNG, WebP or HEIC/HEIF. Gets a thumbnail and a model copy.
 * - `document`: a PDF. Stored exactly as uploaded and sent to the model as
 *   the PDF itself (Gemini inline `application/pdf`, Claude a `document`
 *   block). The server never parses, renders or rewrites it, and never serves
 *   its bytes back to a browser (a PDF can carry script).
 */
export const ASSISTANT_ATTACHMENT_KINDS = ['image', 'document'] as const;
export type AssistantAttachmentKind = (typeof ASSISTANT_ATTACHMENT_KINDS)[number];

/** The one document type accepted. Word and other office files are not: the user saves them as PDF. */
export const ASSISTANT_DOCUMENT_MIME_TYPE = 'application/pdf';

/**
 * Files one message may carry, of either kind together. Their bytes are then
 * bounded per request by {@link MODEL_REQUEST_ATTACHMENT_BUDGET_BYTES}.
 */
export const ASSISTANT_ATTACHMENTS_PER_MESSAGE = 20;
/** The largest image one attachment may be. */
export const ASSISTANT_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
/**
 * The largest PDF one attachment may be: 10 MiB, which is 13.3 MiB as base64,
 * so one PDF always fits the request budget
 * ({@link MODEL_REQUEST_ATTACHMENT_BUDGET_BYTES}, 16 MiB) with room for a few
 * images, and stays far below each provider's own PDF limit (Gemini: 50 MB per
 * inline PDF, https://ai.google.dev/gemini-api/docs/file-input-methods; Claude:
 * the whole request, https://platform.claude.com/docs/en/build-with-claude/pdf-support,
 * both read 2026-11-14).
 *
 * Pages are deliberately not counted: the server never parses a PDF. A PDF over
 * a provider's page limit (Claude: 600 pages, 100 when the model's context
 * window is under 1M tokens; Gemini: 1,000 pages) is refused by the provider,
 * and the turn then fails with {@link ASSISTANT_DOCUMENT_REJECTED_MESSAGE}.
 */
export const ASSISTANT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** The largest file the upload route reads before it knows the kind: the larger of the two caps. */
export const ASSISTANT_ATTACHMENT_MAX_BYTES = Math.max(ASSISTANT_IMAGE_MAX_BYTES, ASSISTANT_DOCUMENT_MAX_BYTES);
/** The size cap of one attachment of this kind. */
export const attachmentMaxBytesOf = (kind: AssistantAttachmentKind) =>
  kind === 'document' ? ASSISTANT_DOCUMENT_MAX_BYTES : ASSISTANT_IMAGE_MAX_BYTES;
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
 * Attachment bytes, as sent (base64, 4/3 of the file), one model request may
 * carry, images and PDFs together: the chat context and the question paper
 * generation job (page photos only) share it. It is deliberately well below
 * what the providers accept today (Gemini: 100 MB of inline data per request,
 * 50 MB per PDF, https://ai.google.dev/gemini-api/docs/file-input-methods;
 * Claude: 128 MB per request on the first-party API,
 * https://platform.claude.com/docs/en/api/overview#request-size-limits, both
 * read 2026-11-14; both were 20 MB and 32 MB when this was set): the whole
 * history is re-sent on every step of a tool loop, so bytes are cost and
 * latency. 16 MiB leaves the rest for the system prompt, tools and history.
 */
export const MODEL_REQUEST_ATTACHMENT_BUDGET_BYTES = 16 * 1024 * 1024;
/** The size a file takes in a request: providers receive images and PDFs base64 encoded. */
export const encodedImageBytes = (bytes: number) => Math.ceil((bytes * 4) / 3);
/** The multipart field of the upload route (one file per request). */
export const ASSISTANT_ATTACHMENT_FIELD_NAME = 'file';
/** Media types the picker offers; the server decides with the file's bytes. */
export const ASSISTANT_ATTACHMENT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf';

/** The sentence for a file that is neither an accepted image nor a PDF (the server's 415 and the composer's refusal). */
export const ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE =
  'Only images (JPEG, PNG, WebP, HEIC) and PDF files can be attached. Save Word and other documents as PDF and attach the PDF.';

/**
 * The run failure shown when the provider refused a request that carried a
 * PDF. The provider does not say which limit it hit in a stable form, and the
 * server never parses a PDF, so the sentence names the usual causes and what
 * to do. The PDF stays in the model's view until it is two human messages
 * old, so the way out is a new conversation.
 */
export const ASSISTANT_DOCUMENT_REJECTED_MESSAGE =
  'The assistant could not read an attached PDF. It may have too many pages, be protected by a password, or be damaged. Start a new conversation and attach a shorter PDF without a password, or photos of its pages.';

/**
 * How many leading bytes may come before `%PDF-`. PDF readers (Acrobat, pdf.js)
 * look for the header within the first 1,024 bytes, so a file a reader opens
 * is accepted here too.
 */
export const PDF_HEADER_SEARCH_BYTES = 1024;
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/**
 * Whether these leading bytes are a PDF: `%PDF-` at offset 0 or within the
 * first {@link PDF_HEADER_SEARCH_BYTES} bytes. Pass at least that many bytes
 * of the file. Used by the upload route and by the browser before upload; the
 * file name and declared type are never consulted.
 */
export function hasPdfSignature(head: Uint8Array): boolean {
  const last = Math.min(head.length - PDF_HEADER.length, PDF_HEADER_SEARCH_BYTES - PDF_HEADER.length);
  for (let at = 0; at <= last; at += 1) {
    if (PDF_HEADER.every((byte, index) => head[at + index] === byte)) return true;
  }
  return false;
}

/** What the message and the composer know about one attachment (no bytes, no URLs). */
export const assistantAttachmentRefSchema = z.object({
  /** `asat_...` */
  id: z.string().min(1),
  /** Image or document, as the server decided from the bytes. */
  kind: z.enum(ASSISTANT_ATTACHMENT_KINDS),
  /** The client's file name, sanitised, for display only. */
  fileName: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  /** Null for a document and for an image the server could not decode. */
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** True only for an image the server decoded: it has a thumbnail. A document never has one. */
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
/** `DELETE` here removes one file the user attached but has not sent yet. */
export const assistantAttachmentDeletePath = (schoolId: string, attachmentId: string) =>
  `${assistantAttachmentUploadPath(schoolId)}/${encodeURIComponent(attachmentId)}`;
/** An image's thumbnail or original. A document has neither: its bytes are never served back to a browser. */
export const assistantAttachmentReadPath = (schoolId: string, attachmentId: string, variant: 'thumb' | 'original') =>
  `${assistantAttachmentUploadPath(schoolId)}/${encodeURIComponent(attachmentId)}/${variant}`;

/** `data.reason` of the refusal for a message that names images the server no longer holds (evicted or removed); `data.attachmentIds` lists them. */
export const ASSISTANT_ATTACHMENTS_MISSING_REASON = 'attachments_missing';
