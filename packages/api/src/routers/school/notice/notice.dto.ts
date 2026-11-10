import { z } from 'zod';

import { createListInputSchema, createPaginatedOutputSchema } from '../../../paginations';

/**
 * DTOs of school notices. This file imports nothing but Zod and the
 * pagination helpers, so the browser apps can import its schemas, constants
 * and types directly. The enum values mirror the database enums
 * (`@campuspilot/db/schema/notice`); `notice.service.ts` fails to compile if
 * they drift apart.
 */

/** `plain`: text placed into the school's Notice template. `template`: the author's Handlebars source is the whole document. */
export const NOTICE_BODY_MODES = ['plain', 'template'] as const;
export type NoticeBodyMode = (typeof NOTICE_BODY_MODES)[number];

/** One-way: a published notice is immutable. */
export const NOTICE_STATUSES = ['draft', 'published'] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/** Which students a notice is addressed to; independent of `toStaff`. */
export const NOTICE_CADET_SCOPES = ['none', 'all_classes', 'selected_classes'] as const;
export type NoticeCadetScope = (typeof NOTICE_CADET_SCOPES)[number];

export const NOTICE_TITLE_MAX_LENGTH = 200;
/** Same limit as a document template's source. */
export const NOTICE_BODY_MAX_LENGTH = 200_000;
/** Classes one notice can name. */
export const NOTICE_MAX_CLASSES = 200;

const id = z.string().trim().min(1).max(100);

export const noticeTitleSchema = z
  .string()
  .trim()
  .min(1, 'Enter a title.')
  .max(NOTICE_TITLE_MAX_LENGTH, `Use at most ${NOTICE_TITLE_MAX_LENGTH} characters.`);
export const noticeBodySchema = z
  .string()
  .trim()
  .min(1, 'Enter the notice text.')
  .max(NOTICE_BODY_MAX_LENGTH, 'The notice is too long.');

/**
 * The audience as three explicit inputs. `classIds` is meaningful only for
 * `selected_classes`; it must be empty for the other scopes rather than
 * silently ignored, so a stale selection can never look saved.
 */
const audienceShape = {
  toStaff: z
    .boolean()
    .describe('Address the notice to the school staff (every member).')
    // An example, so a client building the smallest input from the schema
    // addresses someone (false with cadetScope none is refused).
    .meta({ examples: [true] }),
  cadetScope: z.enum(NOTICE_CADET_SCOPES).describe('Students addressed: none, every class of the session, or the classes in classIds. Anything but none needs the school to have the Cadet Portal.'),
  classIds: z
    .array(id)
    .max(NOTICE_MAX_CLASSES)
    .default([])
    .describe('Class IDs from school.listClasses; required for selected_classes, empty otherwise.'),
};

type AudienceInput = { toStaff: boolean; cadetScope: NoticeCadetScope; classIds: string[] };

/** Shared by create and update, and by the management form's validator. */
export function validateNoticeAudience(value: AudienceInput, context: z.RefinementCtx) {
  if (!value.toStaff && value.cadetScope === 'none') {
    context.addIssue({ code: 'custom', path: ['toStaff'], message: 'Choose who the notice is for.' });
  }
  if (value.cadetScope === 'selected_classes' && value.classIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['classIds'], message: 'Choose at least one class.' });
  }
  if (value.cadetScope !== 'selected_classes' && value.classIds.length > 0) {
    context.addIssue({ code: 'custom', path: ['classIds'], message: 'Classes can be chosen only for selected classes.' });
  }
  if (new Set(value.classIds).size !== value.classIds.length) {
    context.addIssue({ code: 'custom', path: ['classIds'], message: 'Each class can be chosen once.' });
  }
}

const contentShape = {
  title: noticeTitleSchema,
  bodyMode: z.enum(NOTICE_BODY_MODES),
  body: noticeBodySchema.describe('Plain text (blank lines separate paragraphs) or, for bodyMode template, the complete Handlebars/HTML document.'),
};

export const noticeScopeInputSchema = z.object({ schoolId: id, noticeId: id });

export const createNoticeInputSchema = z
  .object({ schoolId: id, sessionId: id, ...contentShape, ...audienceShape })
  .superRefine(validateNoticeAudience);

/** A full replacement of a draft's content and audience. */
export const updateNoticeInputSchema = z
  .object({ schoolId: id, noticeId: id, ...contentShape, ...audienceShape })
  .superRefine(validateNoticeAudience);

export const listNoticesInputSchema = createListInputSchema({
  schoolId: id,
  sessionId: id,
  searchQuery: z.string().trim().max(100).default('').describe('Matches the title.'),
  filters: z
    .object({
      status: z.enum(NOTICE_STATUSES).optional(),
      toStaff: z.boolean().optional().describe('Only notices that are (true) or are not (false) addressed to staff.'),
      toCadets: z.boolean().optional().describe('Only notices that are (true) or are not (false) addressed to students.'),
    })
    .default({}),
  orderBy: z
    .object({
      field: z.enum(['createdAt', 'publishedAt', 'title']),
      direction: z.enum(['asc', 'desc']),
    })
    .default({ field: 'createdAt', direction: 'desc' })
    .describe('publishedAt lists drafts (never published) last.'),
});

/** What the caller may do with this notice now (permission and ownership combined by the server). */
const noticeViewerSchema = z.object({
  /** Edit or delete: a draft the caller wrote, or any draft for a holder of publish. */
  canEdit: z.boolean(),
  /** Publish: a draft, and the caller holds the publish permission. */
  canPublish: z.boolean(),
});

const noticeSummaryShape = {
  id: z.string(),
  schoolId: z.string(),
  sessionId: z.string(),
  title: z.string(),
  bodyMode: z.enum(NOTICE_BODY_MODES),
  status: z.enum(NOTICE_STATUSES),
  toStaff: z.boolean(),
  cadetScope: z.enum(NOTICE_CADET_SCOPES),
  /** Classes addressed, in class display order; empty unless `selected_classes`. */
  classIds: z.array(z.string()),
  /** The author's account ID and name; null after the account is deleted. */
  createdBy: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  publishedBy: z.string().nullable(),
  publishedByName: z.string().nullable(),
  publishedAt: z.date().nullable(),
  /** School members and students notified at publication; null for a draft. */
  publishedStaffCount: z.number().int().nonnegative().nullable(),
  publishedCadetCount: z.number().int().nonnegative().nullable(),
  viewer: noticeViewerSchema,
};

/** A notice without its body (list rows). */
export const noticeSummaryDtoSchema = z.object(noticeSummaryShape);
export type NoticeSummaryDto = z.infer<typeof noticeSummaryDtoSchema>;

export const noticeDtoSchema = z.object({
  ...noticeSummaryShape,
  body: z.string(),
  /**
   * The Notice template revision pinned at publication (plain notices
   * only); null for a draft, a template notice, and a plain notice published
   * with the built-in default design.
   */
  templateRevisionId: z.string().nullable(),
});
export type NoticeDto = z.infer<typeof noticeDtoSchema>;

export const listNoticesOutputSchema = createPaginatedOutputSchema(noticeSummaryDtoSchema);

/**
 * What to preview: a saved notice exactly as stored, or unsaved content
 * (the editor's live preview). Nothing is persisted either way.
 */
export const previewNoticeInputSchema = z.object({
  schoolId: id,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('saved'), noticeId: id }),
    z.object({ kind: z.literal('unsaved'), sessionId: id, ...contentShape }),
  ]),
});

/** Sanitized HTML for an empty-sandbox iframe (`DocumentPreview`). */
export const noticePreviewOutputSchema = z.object({ html: z.string() });

export const noticeDownloadOutputSchema = z.object({ url: z.url(), expiresIn: z.number().int() });
