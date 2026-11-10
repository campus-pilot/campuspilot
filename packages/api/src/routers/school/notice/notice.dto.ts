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

/**
 * The paper a notice is printed on, as the document system names template
 * page sizes: `full` = portrait A4, the notice flowing over as many A4 pages
 * as it needs; `half` = half an A4 sheet (210 x 148.5 mm), the notice flowing
 * over as many half pages as it needs, with two copies of each half page
 * imposed on every printed A4 sheet (cut along the guide). Chosen per
 * notice for both body modes; templates read it as `print.size`.
 */
export const NOTICE_PAGE_SIZES = ['full', 'half'] as const;
export type NoticePageSize = (typeof NOTICE_PAGE_SIZES)[number];
/** Labels shared by every screen that states a notice's print size. */
export const NOTICE_PAGE_SIZE_LABELS: Record<NoticePageSize, string> = { full: 'Full A4', half: 'Half A4' };

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

const PAGE_SIZE_DESCRIPTION =
  'Paper the notice prints on, for either body mode: full (portrait A4 pages) or half (half-A4 pages, two copies per printed A4 sheet). Templates adapt to it through print.size.';

/**
 * The print size of a new notice or of unsaved preview content: a notice
 * starts on full A4 unless the caller says otherwise.
 */
const pageSizeWithDefaultSchema = z
  .enum(NOTICE_PAGE_SIZES)
  .default('full')
  .describe(`${PAGE_SIZE_DESCRIPTION} Defaults to full.`);

/**
 * The print size of a draft being replaced. Required, never defaulted:
 * `updateNotice` is a full replacement, and a caller that leaves the size
 * out (an older client, a script, an agent) must not silently turn a
 * half-A4 draft back into full A4 (review round 4, R4-2).
 */
const requiredPageSizeSchema = z
  .enum(NOTICE_PAGE_SIZES)
  .describe(`${PAGE_SIZE_DESCRIPTION} Required: send the draft's current pageSize from getNotice to keep it.`);

export const noticeScopeInputSchema = z.object({ schoolId: id, noticeId: id });

/**
 * The `version` of the notice the caller last read (`getNotice`,
 * `previewNoticePublish`). The write is refused with CONFLICT when the
 * stored notice has a different version, so nobody overwrites or publishes
 * content they have not seen.
 */
const expectedVersionSchema = z
  .number()
  .int()
  .positive()
  .describe('version from getNotice (or previewNoticePublish) of the notice as you last read it; a different stored version is refused with CONFLICT.');

/**
 * The school Notice template revision of the preview the caller reviewed
 * (`previewNotice.templateRevisionId` or
 * `previewNoticePublish.templateRevisionId`); null when that preview used
 * the built-in design or the notice is its own template. A plain notice is
 * printed inside the school's selected Notice template, which a template
 * manager can replace at any time and which may carry text of its own, so
 * the reviewed revision is as much part of "what the publisher saw" as the
 * notice's version. Publication is refused with CONFLICT when the notice
 * would now be printed with another revision. Required (never defaulted):
 * a caller that has not looked at a preview has nothing to confirm.
 */
const expectedTemplateRevisionIdSchema = id
  .nullable()
  .describe('templateRevisionId from previewNotice or previewNoticePublish of the preview you reviewed (null = built-in design or a custom-template notice); publication with another template revision is refused with CONFLICT.');

/** Publishing names what was reviewed, the notice version and the template revision it was shown in: publication is irreversible. */
export const publishNoticeInputSchema = z.object({
  schoolId: id,
  noticeId: id,
  expectedVersion: expectedVersionSchema,
  expectedTemplateRevisionId: expectedTemplateRevisionIdSchema,
});

/** The CONFLICT message of a stale `expectedVersion` (the UI shows it and reloads the notice). */
export const NOTICE_CHANGED_MESSAGE = 'This notice changed since you opened it. Review it again.';
/** The CONFLICT message of a stale `expectedTemplateRevisionId` (the UI shows it and reloads the preview). */
export const NOTICE_TEMPLATE_CHANGED_MESSAGE = "The school's Notice template changed since you opened this notice. Review it again.";

export const createNoticeInputSchema = z
  .object({ schoolId: id, sessionId: id, ...contentShape, pageSize: pageSizeWithDefaultSchema, ...audienceShape })
  .superRefine(validateNoticeAudience);

/**
 * A full replacement of a draft's content, print size and audience, based on
 * the version the caller read. Every field is required, `pageSize` included.
 */
export const updateNoticeInputSchema = z
  .object({ schoolId: id, noticeId: id, expectedVersion: expectedVersionSchema, ...contentShape, pageSize: requiredPageSizeSchema, ...audienceShape })
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
  /**
   * The existing classes addressed, in class display order; empty unless
   * `selected_classes`. This is the selection to edit: a class deleted since
   * is not in it (see `classes`).
   */
  classIds: z.array(z.string()),
  /**
   * The audience record of a `selected_classes` notice, for display. A
   * published notice lists each class by the name it had at publication,
   * also after the class was renamed or deleted (`classId` null = deleted).
   * A draft lists its classes by their current names.
   */
  classes: z.array(z.object({ classId: z.string().nullable(), name: z.string() })),
  /** Counts saved changes; send it back as `expectedVersion` to update or publish. */
  version: z.number().int().positive(),
  /** The author's account ID and name; null after the account is deleted. */
  createdBy: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  publishedBy: z.string().nullable(),
  publishedByName: z.string().nullable(),
  publishedAt: z.date().nullable(),
  /** The calendar date printed on the notice (`YYYY-MM-DD`), fixed at publication; null for a draft. */
  issuedOn: z.string().nullable(),
  /**
   * The paper the notice prints on (both body modes). Part of the saved
   * content: changing it is an edit that increments `version`, and it is
   * fixed once the notice is published.
   */
  pageSize: z.enum(NOTICE_PAGE_SIZES),
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
    z.object({ kind: z.literal('unsaved'), sessionId: id, ...contentShape, pageSize: pageSizeWithDefaultSchema }),
  ]),
});

/**
 * A rendered notice and what exactly was rendered, so a reader can later
 * say which preview they reviewed (`publishNotice`).
 */
export const noticePreviewOutputSchema = z.object({
  /** Sanitized HTML for an empty-sandbox iframe (`DocumentPreview`). */
  html: z.string(),
  /** The version of the saved notice that was rendered; null for unsaved content. */
  version: z.number().int().positive().nullable(),
  /**
   * The school Notice template revision the page was rendered with: the
   * pinned one for a published notice, the school's current selection for a
   * draft or unsaved text. Null for the built-in design and for a notice
   * that is its own template.
   */
  templateRevisionId: z.string().nullable(),
  /** The paper this page was laid out for: the notice's `pageSize` (the unsaved content's for an unsaved preview). */
  pageSize: z.enum(NOTICE_PAGE_SIZES),
});

export const noticeDownloadOutputSchema = z.object({ url: z.url(), expiresIn: z.number().int() });
