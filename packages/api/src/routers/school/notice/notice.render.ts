import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import type { NoticeRow } from '@campuspilot/db/schema/notice';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';
import Handlebars from 'handlebars';
import { randomBytes } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';

import { rpcError } from '../../../errors';
import { DOCUMENT_MARKETPLACE, NOTICE_DEFAULT_TEMPLATE_SLUG, SAMPLE_NOTICE_CONTEXT } from '../document/document.catalog';
import { buildSchoolDocumentContext } from '../document/document.context';
import { combineDocuments, convertDocumentPdf, isEmbeddableDocumentImage, renderDocument } from '../document/document.render';
import { getSelectedDocumentTemplate } from '../document/document.selected-template';
import { readDocumentTemplate } from '../document/document.storage';
import type { NoticeBodyMode } from './notice.dto';

/**
 * Rendering of notices (decisions D4, D9; docs/document-system.md).
 *
 * A notice is rendered through the document system's restricted Handlebars
 * renderer and sanitizer, with a context that holds school, session and
 * notice facts only ({@link buildNoticeContext}):
 * - `plain`: the text is **data**. It is split into paragraphs and placed
 *   into a Notice template (the revision pinned at publication, else the
 *   school's selected template, else the built-in default design). It is
 *   never compiled as Handlebars, and templates print it escaped.
 * - `template`: the author's source **is** the document. It is compiled by
 *   the same restricted Handlebars instance and its output sanitized like
 *   any school template; it can read nothing but the notice context.
 */

/** The content of a notice as rendering needs it (a saved row or unsaved input). */
export type NoticeContent = {
  schoolId: string;
  sessionId: string;
  title: string;
  bodyMode: NoticeBodyMode;
  body: string;
};

/** The built-in design: also the fallback for a school without a Notice template. */
function builtInNoticeTemplate() {
  const item = DOCUMENT_MARKETPLACE.find((entry) => entry.slug === NOTICE_DEFAULT_TEMPLATE_SLUG && entry.documentType === 'notice');
  if (!item) throw new Error('The built-in notice template is missing from the catalog.');
  return item.content;
}

/**
 * Splits plain text into paragraphs at blank lines. Single line breaks stay
 * inside a paragraph (templates print them with `white-space: pre-wrap`).
 */
export function noticeParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*(?:\n[ \t]*)+/)
    .map((paragraph) => paragraph.replace(/[ \t]+$/gm, '').trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** The calendar date of an instant in a time zone, as `YYYY-MM-DD`. */
function localIsoDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** A `YYYY-MM-DD` calendar date in words (`15 October 2026`). No time zone is involved: the date is already decided. */
function dateInWords(isoDate: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

/**
 * The time zone a notice's date is shown in: the session's configured
 * finance time zone (the only time zone a school states), else UTC. A
 * stored value `Intl` does not accept falls back to UTC rather than failing
 * the render.
 */
function noticeTimeZone(financeConfig: unknown): string {
  const candidate = financeConfig && typeof financeConfig === 'object' ? (financeConfig as { timeZone?: unknown }).timeZone : undefined;
  if (typeof candidate !== 'string' || !candidate) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return 'UTC';
  }
}

/**
 * The field names of `T` at every level, values unconstrained (an array is a
 * leaf). `buildNoticeContext` must satisfy this for the sample context, so a
 * field can only be added to, or dropped from, both at once; the editor's
 * variable list (`notice-template-guide.ts`) is exhaustive over the same
 * sample.
 */
type SameFields<T> = { [K in keyof T]: T[K] extends readonly unknown[] ? unknown : T[K] extends object ? SameFields<T[K]> : unknown };

/**
 * The complete Handlebars context of a notice: the school block every
 * document shares, the session years, and the notice's own facts. Nothing
 * about students, staff, results or money is reachable from a notice
 * template, whoever wrote it. The session must belong to the school.
 *
 * The date facts are passed in, never derived here:
 * - `generatedAt` is the publication instant (or "now" for a draft);
 * - `issuedOn` is the calendar date printed on the notice. A published
 *   notice passes the date stored at publication (`notice.issued_on`), so it
 *   never moves; a draft or unsaved preview passes null and gets today's
 *   date in the session's time zone ({@link noticeTimeZone}).
 *
 * The school's name, location, registration number and logo are read live
 * on every render, by decision: a published notice shows the school's
 * current letterhead (its cached PDF keeps the letterhead of the moment it
 * was first rendered; see docs/notices.md "What is fixed at publication").
 */
export async function buildNoticeContext(db: DatabaseExecutor, content: NoticeContent, dates: { generatedAt: Date; issuedOn: string | null; omitLogo?: boolean }) {
  const [school] = await db
    .select({ name: schoolTable.name, location: schoolTable.location, registrationNo: schoolTable.registrationNo, logoS3Key: schoolTable.logoS3Key })
    .from(schoolTable)
    .where(eq(schoolTable.id, content.schoolId))
    .limit(1);
  if (!school) throw rpcError.notFound('School');
  const [session] = await db
    .select({ startYear: schoolSessionTable.sessionStartYear, endYear: schoolSessionTable.sessionEndYear, financeConfig: schoolSessionTable.financeConfig })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.id, content.sessionId), eq(schoolSessionTable.schoolId, content.schoolId)))
    .limit(1);
  if (!session) throw rpcError.notFound('School session');
  const issuedOn = dates.issuedOn ?? localIsoDate(dates.generatedAt, noticeTimeZone(session.financeConfig));
  return {
    // `omitLogo`: a text-only render never reads the logo object.
    school: await buildSchoolDocumentContext(dates.omitLogo ? { ...school, logoS3Key: null } : school),
    session: { startYear: session.startYear, endYear: session.endYear },
    generatedAt: dates.generatedAt.toISOString(),
    notice: {
      title: content.title,
      issuedOn,
      issuedOnDisplay: dateInWords(issuedOn),
      /** Empty for a `template` notice: its body is the document, not data. */
      paragraphs: content.bodyMode === 'plain' ? noticeParagraphs(content.body) : [],
    },
  } satisfies SameFields<typeof SAMPLE_NOTICE_CONTEXT>;
}

/**
 * The school's selected Notice template revision, or null when it has
 * selected none (the built-in default design applies).
 */
export async function selectedNoticeTemplate(db: DatabaseExecutor, schoolId: string): Promise<{ revisionId: string; content: string } | null> {
  try {
    const template = await getSelectedDocumentTemplate(db, { schoolId, documentType: 'notice' });
    return { revisionId: template.row.id, content: template.content };
  } catch (error) {
    if (error instanceof ORPCError && error.status === 404) return null;
    throw error;
  }
}

/** A pinned template revision of this school (never another school's or another type's). */
async function pinnedNoticeTemplate(db: DatabaseExecutor, schoolId: string, revisionId: string) {
  const [row] = await db
    .select({ s3Key: artifactTable.s3Key })
    .from(artifactTable)
    .where(and(eq(artifactTable.id, revisionId), eq(artifactTable.schoolId, schoolId), eq(artifactTable.kind, 'template'), eq(artifactTable.documentType, 'notice')))
    .limit(1);
  if (!row) throw new Error(`Notice template revision ${revisionId} is missing.`);
  return readDocumentTemplate(row.s3Key);
}

/**
 * Which template a notice is rendered with.
 * - `pinned`: a published notice: exactly the revision recorded at
 *   publication (`null` = the built-in default design);
 * - `current`: a draft or unsaved content: whatever the school has selected
 *   now, which is what publishing would pin.
 */
export type NoticeTemplateChoice = { kind: 'pinned'; revisionId: string | null } | { kind: 'current' };

/** The Handlebars source a notice is compiled from and, for `current`, the revision it came from. */
async function noticeSource(db: DatabaseExecutor, content: NoticeContent, choice: NoticeTemplateChoice) {
  if (content.bodyMode === 'template') {
    // Checked on every render, not only on save: an unsaved preview never
    // passes through the save validation.
    assertBoundedNoticeTemplate(content.body);
    return { source: content.body, revisionId: null };
  }
  if (choice.kind === 'pinned') {
    return { source: choice.revisionId ? await pinnedNoticeTemplate(db, content.schoolId, choice.revisionId) : builtInNoticeTemplate(), revisionId: choice.revisionId };
  }
  const selected = await selectedNoticeTemplate(db, content.schoolId);
  return { source: selected?.content ?? builtInNoticeTemplate(), revisionId: selected?.revisionId ?? null };
}

/**
 * The most a notice may render to, in characters, before the school logo is
 * placed. Enforced while rendering by the document renderer's output meter,
 * identically for the save-time check, every preview and the publication.
 * A long plain notice is about a tenth of this.
 */
export const NOTICE_RENDER_MAX_CHARS = 2_000_000;

/**
 * The budget for re-rendering a notice that is already published. The
 * school's letterhead facts are read live, so a published notice that fitted
 * {@link NOTICE_RENDER_MAX_CHARS} must not become unreadable because the
 * school's name grew a little; twice the publication budget is the headroom.
 */
export const NOTICE_PUBLISHED_RENDER_MAX_CHARS = 2 * NOTICE_RENDER_MAX_CHARS;

/** How many times one notice may show the school logo (letterhead, footer, watermark). */
export const NOTICE_MAX_LOGO_USES = 3;

/**
 * Renders one notice source against a notice context: the only way notice
 * HTML is produced (save-time validation, previews, publication, the PDF).
 *
 * The school logo is the one large value in the context (a data URI of up to
 * several megabytes), and an author can repeat any value they are handed.
 * So the template never receives it: it is rendered with a short, random,
 * single-use placeholder in `school.logoUrl`, the output is capped by the
 * renderer's meter at `maxChars`, and only then is the placeholder replaced
 * by the real image, at most {@link NOTICE_MAX_LOGO_USES} times (more is a
 * BAD_REQUEST). The size of a rendered notice is therefore bounded by
 * `maxChars + NOTICE_MAX_LOGO_USES x logo`, whatever the template does, and
 * the bound is the same whether the context is the sample or a real school
 * with a 5 MB logo. A logo the sanitizer would not keep (not a PNG, JPEG or
 * WebP data URI) is placed as nothing.
 */
export function renderNoticeDocument<C extends { school: { logoUrl: string | null } }>(source: string, context: C, maxChars: number): string {
  const logo = context.school.logoUrl;
  if (!logo) return combineDocuments([renderDocument(source, context, { maxOutputChars: maxChars })], 'notice', 'full');
  // Hex is inside the base64 alphabet, so the placeholder passes the
  // sanitizer's image filter and is never changed by HTML escaping.
  const placeholder = `data:image/png;base64,${randomBytes(24).toString('hex')}`;
  const html = combineDocuments(
    [renderDocument(source, { ...context, school: { ...context.school, logoUrl: placeholder } }, { maxOutputChars: maxChars })],
    'notice',
    'full',
  );
  const pieces = html.split(placeholder);
  if (pieces.length - 1 > NOTICE_MAX_LOGO_USES) {
    throw rpcError.badRequest(`A notice can show the school logo at most ${NOTICE_MAX_LOGO_USES} times.`);
  }
  return pieces.join(isEmbeddableDocumentImage(logo) ? logo : '');
}

/**
 * Renders a notice to the sanitized, CSP-wrapped HTML shown in the sandboxed
 * preview and converted to PDF. Returns the template revision used (null for
 * the built-in default and for `template` notices) and the issued-on date it
 * printed (publication stores exactly that date). An invalid or oversized
 * template (the author's or the school's) is a BAD_REQUEST from the renderer.
 */
export async function renderNoticeHtml(
  db: DatabaseExecutor,
  content: NoticeContent,
  options: { generatedAt: Date; issuedOn: string | null; template: NoticeTemplateChoice; maxChars?: number },
): Promise<{ html: string; templateRevisionId: string | null; issuedOn: string }> {
  const { source, revisionId } = await noticeSource(db, content, options.template);
  const context = await buildNoticeContext(db, content, options);
  return {
    html: renderNoticeDocument(source, context, options.maxChars ?? NOTICE_RENDER_MAX_CHARS),
    templateRevisionId: revisionId,
    issuedOn: context.notice.issuedOn,
  };
}

/** How deeply block helpers (`each`, `if`, `with`, ...) may nest in an author's notice source. */
export const NOTICE_TEMPLATE_MAX_BLOCK_DEPTH = 4;

/**
 * Structural limits on an author's notice source, beyond what the shared
 * renderer enforces. A notice template can be written by every staff role
 * (school templates only by roles that manage templates), so constructs
 * with no place in a notice are refused outright:
 * - partials and inline partials (`{{> name}}`, `{{#*inline}}`): an inline
 *   partial can call itself, which is unbounded recursion from a few lines;
 * - block helpers nested deeper than {@link NOTICE_TEMPLATE_MAX_BLOCK_DEPTH}.
 *   An `{{else if}}` chain is one level however long it is: Handlebars
 *   parses each `else if` as a block inside the previous one's else branch,
 *   but a chain only ever runs one branch, so it is counted as flat.
 *
 * These limits keep templates simple; they do **not** bound the output
 * (nested `each` multiplies whatever depth is allowed). The output is
 * bounded by the renderer's meter and the logo placeholder, see
 * {@link renderNoticeDocument}. Invalid syntax is left to the renderer,
 * which reports it as BAD_REQUEST.
 */
function assertBoundedNoticeTemplate(source: string) {
  let program: hbs.AST.Program;
  try {
    program = Handlebars.parse(source);
  } catch {
    return;
  }
  const visit = (node: hbs.AST.Node | null | undefined, depth: number): void => {
    if (!node) return;
    switch (node.type) {
      case 'Program':
        for (const statement of (node as hbs.AST.Program).body) visit(statement, depth);
        return;
      case 'BlockStatement': {
        if (depth + 1 > NOTICE_TEMPLATE_MAX_BLOCK_DEPTH) {
          throw rpcError.badRequest(`A notice template can nest blocks such as each and if at most ${NOTICE_TEMPLATE_MAX_BLOCK_DEPTH} levels deep.`);
        }
        const block = node as hbs.AST.BlockStatement;
        visit(block.program, depth + 1);
        // `{{else if …}}`: the chained block continues this block's level.
        visit(block.inverse, (block.inverse as (hbs.AST.Program & { chained?: boolean }) | undefined)?.chained ? depth : depth + 1);
        return;
      }
      case 'PartialStatement':
      case 'PartialBlockStatement':
      case 'Decorator':
      case 'DecoratorBlock':
        throw rpcError.badRequest('A notice template cannot use partials.');
      default:
        return;
    }
  };
  visit(program, 0);
}

/**
 * Checks an author's Handlebars source before it is saved: the structural
 * limits above, then a render against the synthetic notice context through
 * {@link renderNoticeDocument}, so the save-time check applies the same
 * output budget and logo limit as every later render. Invalid syntax or an
 * unsupported helper is a BAD_REQUEST exactly as for a school template.
 */
export function assertValidNoticeTemplate(source: string) {
  assertBoundedNoticeTemplate(source);
  renderNoticeDocument(source, SAMPLE_NOTICE_CONTEXT, NOTICE_RENDER_MAX_CHARS);
}

/**
 * Checks a school Notice template (document system, written by template
 * managers) the way notices will render it: with the notice output budget
 * and logo limit, so a design that could never print a notice is refused
 * when it is saved rather than when a notice is published. The structural
 * limits for authors' own sources do not apply to school templates.
 */
export function assertValidSchoolNoticeTemplate(source: string) {
  renderNoticeDocument(source, SAMPLE_NOTICE_CONTEXT, NOTICE_RENDER_MAX_CHARS);
}

/** Renders a published notice from what was fixed at publication: its content, pinned template revision, instant and issued-on date. */
export function renderPublishedNoticeHtml(db: DatabaseExecutor, notice: PublishedNotice) {
  return renderNoticeHtml(db, notice, {
    generatedAt: notice.publishedAt,
    issuedOn: notice.issuedOn,
    template: { kind: 'pinned', revisionId: notice.templateRevisionId },
    maxChars: NOTICE_PUBLISHED_RENDER_MAX_CHARS,
  });
}

/** The columns of a published notice that rendering reads. */
export type PublishedNotice = Pick<NoticeRow, 'id' | 'schoolId' | 'sessionId' | 'title' | 'bodyMode' | 'body' | 'templateRevisionId'> & { publishedAt: Date; issuedOn: string };

/** A row as a published notice, or null while it is a draft. */
export function asPublishedNotice(row: NoticeRow): PublishedNotice | null {
  return row.status === 'published' && row.publishedAt && row.issuedOn ? { ...row, publishedAt: row.publishedAt, issuedOn: row.issuedOn } : null;
}

const BLOCK_END = /<\/(?:p|div|h[1-6]|li|tr|table|section|article|header|footer|main|ul|ol|blockquote|pre)>|<br\s*\/?>(?!\n)/gi;

/**
 * The readable text of a rendered notice document: no markup, no styles and
 * no images, block elements separated by blank lines. For readers that
 * cannot show the printed page (the Cadet MCP, whose callers must not be
 * sent megabytes of HTML and base64 to read a few sentences).
 */
export function noticeDocumentText(html: string): string {
  const text = sanitizeHtml(html.replace(BLOCK_END, (tag) => `${tag}\n\n`), {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title'],
  });
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The text of a published custom-template notice (see {@link noticeDocumentText}).
 * Rendered without the logo: the text does not need it.
 */
export async function renderPublishedNoticeText(db: DatabaseExecutor, notice: PublishedNotice): Promise<string> {
  const { source } = await noticeSource(db, notice, { kind: 'pinned', revisionId: notice.templateRevisionId });
  const context = await buildNoticeContext(db, notice, { generatedAt: notice.publishedAt, issuedOn: notice.issuedOn, omitLogo: true });
  return noticeDocumentText(renderNoticeDocument(source, context, NOTICE_PUBLISHED_RENDER_MAX_CHARS));
}

/**
 * Where a published notice's PDF is cached (decision D9). Under the
 * school's prefix, so the demo purge's prefix sweep removes it.
 */
export function noticePdfKey(schoolId: string, noticeId: string) {
  return `schools/${schoolId}/notices/${noticeId}.pdf`;
}

function isMissingObject(error: unknown) {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

async function readCachedPdf(key: string): Promise<Uint8Array | null> {
  try {
    const result = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!result.Body) return null;
    return await result.Body.transformToByteArray();
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

async function cachedPdfExists(key: string) {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (isMissingObject(error)) return false;
    throw error;
  }
}

/** Renders in progress in this process, so concurrent first requests convert once. */
const pdfInFlight = new Map<string, Promise<Uint8Array>>();

/** Renders the PDF and stores it under the notice's cache key (one render per process at a time). */
function renderAndStoreNoticePdf(db: Database, notice: PublishedNotice, key: string) {
  let pending = pdfInFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const { html } = await renderPublishedNoticeHtml(db, notice);
      const bytes = new Uint8Array(await convertDocumentPdf(html, 'notice'));
      await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: bytes, ContentType: 'application/pdf' }));
      return bytes;
    })().finally(() => pdfInFlight.delete(key));
    pdfInFlight.set(key, pending);
  }
  return pending;
}

/**
 * The PDF of a published notice: read from the cache, or rendered once and
 * stored (decision D9). The PDF is the same for every recipient and a
 * published notice's content, pinned template and issued-on date are fixed,
 * so the one object backs the staff download, the Cadet Portal download and
 * every WhatsApp attachment. The letterhead in it is the school's as it was
 * when the PDF was first rendered (the HTML view reads it live).
 *
 * Unlike document artifacts, this key is deterministic. Two processes that
 * both miss the cache each render and store the same document under the
 * same key; the later write replaces an equivalent object, which is
 * harmless. Within one process concurrent callers share one render, which
 * is why these take the pooled database, never a caller's transaction.
 */
export async function readNoticePdf(db: Database, notice: PublishedNotice): Promise<Uint8Array> {
  const key = noticePdfKey(notice.schoolId, notice.id);
  return (await readCachedPdf(key)) ?? (await renderAndStoreNoticePdf(db, notice, key));
}

/** Makes sure the cached PDF exists and returns its key (see {@link readNoticePdf}). */
export async function ensureNoticePdfStored(db: Database, notice: PublishedNotice): Promise<string> {
  const key = noticePdfKey(notice.schoolId, notice.id);
  if (!(await cachedPdfExists(key))) await renderAndStoreNoticePdf(db, notice, key);
  return key;
}
