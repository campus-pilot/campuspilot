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

import { rpcError } from '../../../errors';
import { DOCUMENT_MARKETPLACE, NOTICE_DEFAULT_TEMPLATE_SLUG, SAMPLE_NOTICE_CONTEXT } from '../document/document.catalog';
import { buildSchoolDocumentContext } from '../document/document.context';
import { combineDocuments, convertDocumentPdf, renderDocument } from '../document/document.render';
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

/**
 * The calendar date of an instant in a time zone, as `YYYY-MM-DD` and in
 * words (`15 October 2026`).
 */
function localDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return {
    iso: `${part('year')}-${part('month')}-${part('day')}`,
    display: new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(instant),
  };
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
 * The complete Handlebars context of a notice: the school block every
 * document shares, the session years, and the notice's own facts. Nothing
 * about students, staff, results or money is reachable from a notice
 * template, whoever wrote it. The session must belong to the school.
 *
 * `issuedAt` is the publication instant (or "now" for a draft preview); it
 * is also `generatedAt`, so a published notice renders identically every
 * time.
 */
export async function buildNoticeContext(db: DatabaseExecutor, content: NoticeContent, issuedAt: Date) {
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
  const issuedOn = localDate(issuedAt, noticeTimeZone(session.financeConfig));
  return {
    school: await buildSchoolDocumentContext(school),
    session: { startYear: session.startYear, endYear: session.endYear },
    generatedAt: issuedAt.toISOString(),
    notice: {
      title: content.title,
      issuedOn: issuedOn.iso,
      issuedOnDisplay: issuedOn.display,
      /** Empty for a `template` notice: its body is the document, not data. */
      paragraphs: content.bodyMode === 'plain' ? noticeParagraphs(content.body) : [],
    },
  } satisfies Record<keyof typeof SAMPLE_NOTICE_CONTEXT, unknown>;
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
 * Renders a notice to the sanitized, CSP-wrapped HTML shown in the sandboxed
 * preview and converted to PDF. Returns the template revision used (null for
 * the built-in default and for `template` notices). An invalid template
 * (the author's or the school's) is a BAD_REQUEST from the renderer.
 */
export async function renderNoticeHtml(
  db: DatabaseExecutor,
  content: NoticeContent,
  options: { issuedAt: Date; template: NoticeTemplateChoice },
): Promise<{ html: string; templateRevisionId: string | null }> {
  const { source, revisionId } = await noticeSource(db, content, options.template);
  const context = await buildNoticeContext(db, content, options.issuedAt);
  return { html: combineDocuments([renderDocument(source, context)], 'notice', 'full'), templateRevisionId: revisionId };
}

/** How deeply block helpers (`each`, `if`, `with`, ...) may nest in an author's notice source. */
export const NOTICE_TEMPLATE_MAX_BLOCK_DEPTH = 4;

/**
 * Structural limits on an author's notice source, beyond what the shared
 * renderer enforces. A notice template can be written by every staff role
 * (school templates only by roles that manage templates), so the constructs
 * that let a small source do unbounded work are refused outright:
 * - partials and inline partials (`{{> name}}`, `{{#*inline}}`): an inline
 *   partial can call itself, and with the `add` helper as a counter that is
 *   exponential work from a few lines;
 * - block helpers nested deeper than {@link NOTICE_TEMPLATE_MAX_BLOCK_DEPTH}:
 *   nested `each` multiplies. The notice context is tiny (no list is longer
 *   than a handful of keys in a `template` notice), so this depth bounds the
 *   output to a small multiple of the source.
 * Invalid syntax is left to the renderer, which reports it as BAD_REQUEST.
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
        visit(block.inverse, depth + 1);
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
 * limits above, then a render against the synthetic notice context, where
 * invalid syntax or an unsupported helper is a BAD_REQUEST exactly as for a
 * school template.
 */
export function assertValidNoticeTemplate(source: string) {
  assertBoundedNoticeTemplate(source);
  renderDocument(source, SAMPLE_NOTICE_CONTEXT);
}

/** Renders a published notice exactly as it was published. */
export function renderPublishedNoticeHtml(db: DatabaseExecutor, notice: PublishedNotice) {
  return renderNoticeHtml(db, notice, { issuedAt: notice.publishedAt, template: { kind: 'pinned', revisionId: notice.templateRevisionId } });
}

/** The columns of a published notice that rendering reads. */
export type PublishedNotice = Pick<NoticeRow, 'id' | 'schoolId' | 'sessionId' | 'title' | 'bodyMode' | 'body' | 'templateRevisionId'> & { publishedAt: Date };

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
 * published notice never changes (its content, its pinned template and its
 * date are all fixed), so the one object backs the staff download, the
 * Cadet Portal download and every WhatsApp attachment.
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
