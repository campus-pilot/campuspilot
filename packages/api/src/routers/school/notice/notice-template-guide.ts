import type { SAMPLE_NOTICE_CONTEXT } from '../document/document.catalog';

/**
 * What an author of a custom-template notice is told: the variables their
 * template can read and the document a new one starts from. Both are owned
 * here, next to `buildNoticeContext`, and imported by the management editor,
 * so the editor cannot describe a context the server does not build.
 *
 * This file has no runtime import (the catalogue is imported as a type), so
 * browser apps can import it directly, like `notice.dto.ts`.
 *
 * What keeps it in step with the renderer:
 * - {@link NoticeContextPath} is derived from `SAMPLE_NOTICE_CONTEXT`, and
 *   {@link NOTICE_CONTEXT_FIELDS} is an exhaustive record over it: adding,
 *   renaming or removing a context field fails the build until it is
 *   described (or dropped) here;
 * - `buildNoticeContext` must produce exactly the sample's fields
 *   (`satisfies` there, and `notice-template.integration.test.ts` compares
 *   the real context's paths with the sample's);
 * - `notice.render.test.ts` checks that the starter only reads variables
 *   offered here, and that it passes the same validation as a saved notice.
 */

/** Dotted paths of the context's leaves; an array is one leaf. */
type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends readonly unknown[] ? `${Prefix}${K}` : T[K] extends object ? LeafPaths<T[K], `${Prefix}${K}.`> : `${Prefix}${K}`;
}[keyof T & string];

/** Every value a notice template can read, for example `school.name`. */
export type NoticeContextPath = LeafPaths<typeof SAMPLE_NOTICE_CONTEXT>;

export type NoticeContextField = {
  /** What the value is, in the author's words. */
  description: string;
  /**
   * Whether the custom-template editor offers it. Its own fact, not derived
   * from the path: a field can exist in the context (school Notice templates
   * read it) and still be useless to a custom template.
   */
  offeredToAuthors: boolean;
};

/** Every field of the notice context, in the order the editor lists them. */
export const NOTICE_CONTEXT_FIELDS: Record<NoticeContextPath, NoticeContextField> = {
  'notice.title': { description: 'The title above', offeredToAuthors: true },
  'notice.issuedOnDisplay': { description: 'Publication date in words, for example 15 October 2026 (today while a draft)', offeredToAuthors: true },
  'notice.issuedOn': { description: 'The same date as 2026-10-15', offeredToAuthors: true },
  /** Always empty for a custom template: its body is the document, not data. */
  'notice.paragraphs': { description: 'The paragraphs of a plain-text notice (empty in a custom template)', offeredToAuthors: false },
  'school.name': { description: 'School name', offeredToAuthors: true },
  'school.location': { description: 'School address, when set', offeredToAuthors: true },
  'school.registrationNo': { description: 'Registration number, when set', offeredToAuthors: true },
  'school.logoUrl': { description: 'School logo for an <img src>, when uploaded', offeredToAuthors: true },
  'session.startYear': { description: 'First year of the session', offeredToAuthors: true },
  'session.endYear': { description: 'Last year of the session', offeredToAuthors: true },
  /** A machine timestamp; authors use the issued-on dates. */
  generatedAt: { description: 'Publication instant as an ISO timestamp', offeredToAuthors: false },
};

/** The variables the custom-template editor lists, as typed into a template. */
export const NOTICE_TEMPLATE_VARIABLES: readonly { path: NoticeContextPath; name: string; description: string }[] = (
  Object.entries(NOTICE_CONTEXT_FIELDS) as [NoticeContextPath, NoticeContextField][]
)
  .filter(([, field]) => field.offeredToAuthors)
  .map(([path, field]) => ({ path, name: `{{${path}}}`, description: field.description }));

/**
 * What a new custom-template notice starts from: a small, complete letterhead
 * that uses the commonly needed variables, so the author edits a working
 * document instead of facing an empty editor. Notices flow over as many A4
 * pages as they need, so it sets no fixed height.
 */
export const NOTICE_TEMPLATE_STARTER = `<style>
  .notice { font: 14px/1.55 Arial, Helvetica, sans-serif; color: #1f2933; }
  .notice h1 { margin: 0; font-size: 22px; }
  .notice .meta { margin: 2mm 0 8mm; font-size: 12px; color: #52606d; }
  .notice h2 { margin: 0 0 5mm; font-size: 18px; text-align: center; }
  .notice p { margin: 0 0 4mm; }
</style>
<div class="notice">
  <h1>{{school.name}}</h1>
  <p class="meta">Session {{session.startYear}}-{{session.endYear}} · {{notice.issuedOnDisplay}}</p>
  <h2>{{notice.title}}</h2>
  <p>Write your notice here.</p>
</div>
`;
