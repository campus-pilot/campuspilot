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
import { randomBytes } from 'node:crypto';
import { PDFDocument, rgb } from 'pdf-lib';
import sanitizeHtml from 'sanitize-html';

import { rpcError } from '../../../errors';
import { DOCUMENT_MARKETPLACE, NOTICE_DEFAULT_TEMPLATE_SLUG, SAMPLE_NOTICE_CONTEXT } from '../document/document.catalog';
import { buildSchoolDocumentContext } from '../document/document.context';
import { combineDocuments, convertDocumentPdf, isEmbeddableDocumentImage, parseDocumentTemplate, renderDocument } from '../document/document.render';
import { getSelectedDocumentTemplate } from '../document/document.selected-template';
import { readDocumentTemplate } from '../document/document.storage';
import { NOTICE_BODY_MAX_LENGTH, NOTICE_PAGE_SIZES, NOTICE_TITLE_MAX_LENGTH, type NoticeBodyMode, type NoticePageSize } from './notice.dto';

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
  /** The paper it prints on (`notice.page_size`), for both body modes. */
  pageSize: NoticePageSize;
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
    /** The paper the notice prints on, its own fact (`notice.page_size`); designs adapt to it. */
    print: { size: content.pageSize },
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
 *
 * The page size is never part of this choice: it is the notice's own fact
 * (`pageSize`), and a Notice template adapts to it (`print.size`).
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
 * The school Notice template revision a notice would be printed with if it
 * were published now: the school's current selection for a plain notice
 * (null = built-in design), null for a notice that is its own template.
 */
export async function currentNoticeTemplateRevisionId(db: DatabaseExecutor, content: Pick<NoticeContent, 'schoolId' | 'bodyMode'>): Promise<string | null> {
  if (content.bodyMode === 'template') return null;
  return (await selectedNoticeTemplate(db, content.schoolId))?.revisionId ?? null;
}

/**
 * The render budget of a notice before the school logo is placed: the most
 * characters it may render to (block runs count one each as well; see the
 * renderer's `RenderMeter`). Enforced while rendering, identically for the
 * save-time check, every preview and the publication. A long plain notice
 * is about a tenth of this.
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
export function renderNoticeDocument<C extends { school: { logoUrl: string | null }; print: { size: NoticePageSize } }>(source: string, context: C, maxChars: number): string {
  // The layout follows the size the template was told (`print.size`), so
  // the design and the page it is placed on can never disagree.
  const pageSize = context.print.size;
  const logo = context.school.logoUrl;
  if (!logo) return combineDocuments([renderDocument(source, context, { maxOutputChars: maxChars })], 'notice', pageSize);
  // Hex is inside the base64 alphabet, so the placeholder passes the
  // sanitizer's image filter and is never changed by HTML escaping.
  const placeholder = `data:image/png;base64,${randomBytes(24).toString('hex')}`;
  const html = combineDocuments(
    [renderDocument(source, { ...context, school: { ...context.school, logoUrl: placeholder } }, { maxOutputChars: maxChars })],
    'notice',
    pageSize,
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
 * the built-in default and for `template` notices), the page size it was
 * laid out for (the notice's own) and the issued-on date it printed
 * (publication stores exactly that revision and date). An invalid or oversized
 * template (the author's or the school's) is a BAD_REQUEST from the renderer.
 */
export async function renderNoticeHtml(
  db: DatabaseExecutor,
  content: NoticeContent,
  options: { generatedAt: Date; issuedOn: string | null; template: NoticeTemplateChoice; maxChars?: number },
): Promise<{ html: string; templateRevisionId: string | null; pageSize: NoticePageSize; issuedOn: string }> {
  const { source, revisionId } = await noticeSource(db, content, options.template);
  const context = await buildNoticeContext(db, content, options);
  return {
    html: renderNoticeDocument(source, context, options.maxChars ?? NOTICE_RENDER_MAX_CHARS),
    templateRevisionId: revisionId,
    pageSize: content.pageSize,
    issuedOn: context.notice.issuedOn,
  };
}

/** How deeply block helpers (`each`, `if`, `with`, ...) may nest in an author's notice source. */
export const NOTICE_TEMPLATE_MAX_BLOCK_DEPTH = 4;

/**
 * A structural limit on an author's notice source, beyond what the shared
 * renderer enforces for every template (no partials, inline partials or
 * decorators, no helper other than the documented ones, a render budget;
 * see `document.render.ts`). A notice template can be written by every
 * staff role (school templates only by roles that manage templates), so
 * block helpers may nest at most {@link NOTICE_TEMPLATE_MAX_BLOCK_DEPTH}
 * deep. An `{{else if}}` chain is one level here: Handlebars parses each
 * `else if` as a block inside the previous one's else branch, but a chain
 * only ever runs one branch, so it is counted as flat. (The shared parse
 * still limits a chain's length with every template's nesting limit,
 * `DOCUMENT_TEMPLATE_STRUCTURE_LIMITS.blockNesting`, because the parser's
 * cost grows with it.)
 *
 * The limit keeps templates simple; it does **not** bound the output
 * (nested `each` multiplies whatever depth is allowed). The cost of a render
 * is bounded by the renderer's budget and the logo placeholder, see
 * {@link renderNoticeDocument}. Invalid syntax is a BAD_REQUEST from the
 * shared parse, as in the renderer.
 */
function assertBoundedNoticeTemplate(source: string) {
  // The shared parse: invalid syntax and nesting the parser could not handle
  // in linear time are BAD_REQUEST before any tree is built.
  const program = parseDocumentTemplate(source);
  const visit = (node: hbs.AST.Node | null | undefined, depth: number): void => {
    if (!node) return;
    if (node.type === 'Program') {
      for (const statement of (node as hbs.AST.Program).body) visit(statement, depth);
      return;
    }
    if (node.type !== 'BlockStatement') return;
    if (depth + 1 > NOTICE_TEMPLATE_MAX_BLOCK_DEPTH) {
      throw rpcError.badRequest(`A notice template can nest blocks such as each and if at most ${NOTICE_TEMPLATE_MAX_BLOCK_DEPTH} levels deep.`);
    }
    const block = node as hbs.AST.BlockStatement;
    visit(block.program, depth + 1);
    // `{{else if …}}`: the chained block continues this block's level.
    visit(block.inverse, (block.inverse as (hbs.AST.Program & { chained?: boolean }) | undefined)?.chained ? depth : depth + 1);
  };
  visit(program, 0);
}

/**
 * Checks an author's Handlebars source before it is saved: the structural
 * limit above, then a render against the synthetic notice context through
 * {@link renderNoticeDocument}, so the save-time check applies the same
 * budget and logo limit as every later render. An author's source reads no
 * notice text (`paragraphs` is empty for a `template` notice) and gets the
 * logo as a placeholder, so the sample is as large as any real context,
 * apart from the school's name, location and registration number. Invalid
 * syntax or an unsupported helper is a BAD_REQUEST exactly as for a school
 * template. It is checked at the notice's own print size (`pageSize`), the
 * only size it is ever rendered at.
 */
export function assertValidNoticeTemplate(source: string, pageSize: NoticePageSize = 'full') {
  assertBoundedNoticeTemplate(source);
  renderNoticeDocument(source, { ...SAMPLE_NOTICE_CONTEXT, print: { size: pageSize } }, NOTICE_RENDER_MAX_CHARS);
}

/**
 * The largest plain notice a school template can be asked to print: a title
 * and a text of the maximum lengths the notice DTO accepts, as one
 * paragraph (the logo is a placeholder in every notice render, so its size
 * plays no part).
 */
const LONGEST_NOTICE_CONTEXT = {
  ...SAMPLE_NOTICE_CONTEXT,
  notice: { ...SAMPLE_NOTICE_CONTEXT.notice, title: 'W'.repeat(NOTICE_TITLE_MAX_LENGTH), paragraphs: ['W'.repeat(NOTICE_BODY_MAX_LENGTH)] },
};

/**
 * Checks a school Notice template (document system, written by template
 * managers) the way notices will render it: through
 * {@link renderNoticeDocument} with the notice budget and logo limit,
 * against the sample **and** against the longest notice the DTO accepts
 * ({@link LONGEST_NOTICE_CONTEXT}), so a design that could not print a
 * maximum-length notice is refused when it is saved rather than when such a
 * notice is published.
 *
 * This check is a courtesy to the template's author, not the bound: every
 * later render of every notice runs under the same budget, so a template
 * that passes here can never cost more than the budget at render time. A
 * notice it cannot print within the budget (for example tens of thousands
 * of one-line paragraphs in a design with heavy per-paragraph markup) is a
 * BAD_REQUEST for that notice. The structural depth limit for authors' own
 * sources does not apply to school templates.
 *
 * A Notice template prints plain notices of **both** sizes (each notice
 * chooses its own; the template adapts through `print.size`), so every
 * check runs at full and at half A4. The revision's document-system
 * `pageSize` is not a footprint for notices and is always `full`
 * (`validateTemplatePageSize`).
 */
export function assertValidSchoolNoticeTemplate(source: string) {
  for (const size of NOTICE_PAGE_SIZES) renderNoticeDocument(source, { ...SAMPLE_NOTICE_CONTEXT, print: { size } }, NOTICE_RENDER_MAX_CHARS);
  try {
    for (const size of NOTICE_PAGE_SIZES) renderNoticeDocument(source, { ...LONGEST_NOTICE_CONTEXT, print: { size } }, NOTICE_RENDER_MAX_CHARS);
  } catch (error) {
    if (error instanceof ORPCError && error.status === 400) {
      throw rpcError.badRequest(`This design cannot print a notice of the maximum length (${NOTICE_BODY_MAX_LENGTH.toLocaleString('en-IN')} characters) within the rendering limit. Print the notice text fewer times.`, error);
    }
    throw error;
  }
}

/** Renders a published notice from what was fixed at publication: its content and page size, pinned template revision, instant and issued-on date. */
export function renderPublishedNoticeHtml(db: DatabaseExecutor, notice: PublishedNotice) {
  return renderNoticeHtml(db, notice, {
    generatedAt: notice.publishedAt,
    issuedOn: notice.issuedOn,
    template: { kind: 'pinned', revisionId: notice.templateRevisionId },
    maxChars: NOTICE_PUBLISHED_RENDER_MAX_CHARS,
  });
}

/** The columns of a published notice that rendering reads. */
export type PublishedNotice = Pick<NoticeRow, 'id' | 'schoolId' | 'sessionId' | 'title' | 'bodyMode' | 'body' | 'pageSize' | 'templateRevisionId'> & { publishedAt: Date; issuedOn: string };

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
 * school's prefix, so the demo purge's prefix sweep removes it. The pinned
 * page size is part of the key: it never changes for a published notice, so
 * this costs nothing, and a PDF laid out at one size can never be served
 * for a notice printed at the other (for example an object cached before
 * notices had a page size).
 */
export function noticePdfKey(schoolId: string, noticeId: string, pageSize: NoticePageSize) {
  return `schools/${schoolId}/notices/${noticeId}-${pageSize}.pdf`;
}

/** Portrait A4 in PDF points. */
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

/**
 * Imposes a half-page notice for printing on plain A4: every half-A4 page
 * of the converted PDF becomes one portrait A4 sheet carrying that page
 * **twice**, one copy in each half, with a dashed cut guide across the
 * middle (in the pages' blank 10 mm margins). Two copies per sheet is the
 * usual school practice for a half-page notice: print, cut the stack in
 * half, and each half is a complete copy in page order. A long notice
 * therefore prints on as many sheets as it has half pages, each continuing
 * where the last stopped; nothing is clipped. A page that is not exactly
 * half A4 is scaled down to fit its half, never cropped.
 */
export async function imposeHalfPageNoticeCopies(pdf: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdf);
  const output = await PDFDocument.create();
  const pages = await output.embedPages(source.getPages());
  const half = A4_HEIGHT_PT / 2;
  for (const page of pages) {
    const sheet = output.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    const scale = Math.min(A4_WIDTH_PT / page.width, half / page.height, 1);
    const width = page.width * scale;
    const height = page.height * scale;
    const x = (A4_WIDTH_PT - width) / 2;
    for (const top of [half, 0]) sheet.drawPage(page, { x, y: top + (half - height) / 2, width, height });
    sheet.drawLine({ start: { x: 0, y: half }, end: { x: A4_WIDTH_PT, y: half }, thickness: 0.5, color: rgb(0.6, 0.64, 0.69), dashArray: [4, 3] });
  }
  return output.save();
}

/**
 * The printable PDF of a rendered notice at its page size: the converter's
 * output for full A4, imposed two copies per A4 sheet for half A4
 * ({@link imposeHalfPageNoticeCopies}).
 */
async function noticePdfBytes(html: string, pageSize: NoticePageSize): Promise<Uint8Array> {
  const converted = new Uint8Array(await convertDocumentPdf(html, 'notice'));
  return pageSize === 'half' ? imposeHalfPageNoticeCopies(converted) : converted;
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
      const { html, pageSize } = await renderPublishedNoticeHtml(db, notice);
      const bytes = await noticePdfBytes(html, pageSize);
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
  const key = noticePdfKey(notice.schoolId, notice.id, notice.pageSize);
  return (await readCachedPdf(key)) ?? (await renderAndStoreNoticePdf(db, notice, key));
}

/** Makes sure the cached PDF exists and returns its key (see {@link readNoticePdf}). */
export async function ensureNoticePdfStored(db: Database, notice: PublishedNotice): Promise<string> {
  const key = noticePdfKey(notice.schoolId, notice.id, notice.pageSize);
  if (!(await cachedPdfExists(key))) await renderAndStoreNoticePdf(db, notice, key);
  return key;
}
