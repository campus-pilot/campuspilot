import { examQuestionPaperPageTable } from '@campuspilot/db/schema/exam-question-paper';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, eq } from 'drizzle-orm';

import type { Context } from '../../../context';
import { rpcError, rpcErrorResponse } from '../../../errors';
import { parseImageUpload, QUESTION_PAPER_IMAGE_FAMILY } from '../../../files/image-upload';
import { assertPermission } from '../../../permissions/authorization';
import { assertSchoolWritableByCaller } from '../../../school-access/school-access.service';
import { assertSchoolKindServedByCaller, PERSONAL_SPACES_ONLY } from '../../../school-access/school-kind.service';
import { assertQuestionPaperAssistantAccess } from '../question-paper/question-paper.access';
import { QUESTION_PAPER_MAX_PAGE_BYTES, versionNoInputSchema } from '../question-paper/question-paper.dto';
import { QUESTION_PAPER_PAGE_FIELD_NAME } from '../question-paper/question-paper.http';
import { resolveStandalonePaper, type StandalonePaperScope } from '../question-paper/question-paper.scope';
import { storeQuestionPaperPage } from '../question-paper/question-paper.service';
import { getObjectStream, pageImageUrl, QUESTION_PAPER_IMAGE_CACHE_SECONDS } from '../question-paper/question-paper.storage';
import { getVersion, storedVersionPdfKey } from '../question-paper/question-paper.version.service';
import { standalonePaperRefSchema } from './standalone-paper.dto';

/**
 * The HTTP routes of standalone question papers (docs/personal-space.md):
 * storing a reserved page's photo, reading page images and a version's PDF.
 * The same handling as the exam paper routes (`question-paper.http.ts`), with
 * the standalone checks in their order: the school is a personal space (as
 * `requireAuth` holds procedures), the school permission, the assistant gate,
 * and for an upload the school's read-only gate; then the paper must be a
 * standalone paper of that school.
 */

type HttpErrorReporter = (error: unknown) => void;

function parseRef(input: unknown) {
  const parsed = standalonePaperRefSchema.safeParse(input);
  if (!parsed.success) throw rpcError.badRequest('The school and the question paper are required.');
  return parsed.data;
}

function requireUser(context: Context): string {
  const id = context.session?.user.id;
  if (!id) throw rpcError.unauthorized();
  return id;
}

/** The checks of every standalone route, before anything is read: kind, permission, assistant, then the paper itself. */
async function authorize(context: Context, rawRef: unknown, action: 'read' | 'manage'): Promise<{ scope: StandalonePaperScope; userId: string }> {
  const ref = parseRef(rawRef);
  await assertSchoolKindServedByCaller(context, ref.schoolId, PERSONAL_SPACES_ONLY);
  await assertPermission(context, {
    action: action === 'read' ? SCHOOL_ACTIONS.READ_STANDALONE_PAPERS : SCHOOL_ACTIONS.MANAGE_STANDALONE_PAPERS,
    resource: { kind: 'school', schoolId: ref.schoolId },
  });
  const userId = requireUser(context);
  await assertQuestionPaperAssistantAccess(context.db, { schoolId: ref.schoolId, userId });
  // An upload is a change: refused while the school is read-only (suspended, or without an active plan).
  if (action === 'manage') await assertSchoolWritableByCaller(context, ref.schoolId);
  return { scope: await resolveStandalonePaper(context.db, ref), userId };
}

/**
 * Stores the photo of a page reserved with `reserveStandalonePaperPages`
 * (multipart, field `page`, exactly one file), as the exam route does.
 */
export async function handleStandalonePaperPageStore(
  request: Request,
  context: Context,
  rawRef: unknown,
  pageId: string,
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const { scope } = await authorize(context, rawRef, 'manage');
    const upload = await parseImageUpload(request, {
      fieldName: QUESTION_PAPER_PAGE_FIELD_NAME,
      maxBytes: QUESTION_PAPER_MAX_PAGE_BYTES,
      subject: 'page',
      family: QUESTION_PAPER_IMAGE_FAMILY,
    });
    const result = await storeQuestionPaperPage(context.db, {
      scope,
      pageId,
      file: { bytes: upload.bytes, contentType: upload.contentType, extension: upload.extension, name: upload.fileName },
    });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

const PAGE_IMAGE_VARIANTS = ['thumb', 'model', 'original'] as const;
type PageImageVariant = (typeof PAGE_IMAGE_VARIANTS)[number];
const isPageImageVariant = (value: string): value is PageImageVariant => (PAGE_IMAGE_VARIANTS as readonly string[]).includes(value);

/** Redirects to a five-minute URL of a page image (`thumb`, `model` or `original`), as the exam route does. */
export async function handleStandalonePaperPageRead(
  context: Context,
  rawRef: unknown,
  input: { pageId: string; variant: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const { variant } = input;
    if (!isPageImageVariant(variant)) throw rpcError.notFound('Question paper page');
    const { scope } = await authorize(context, rawRef, 'read');
    const [page] = await context.db
      .select()
      .from(examQuestionPaperPageTable)
      .where(and(eq(examQuestionPaperPageTable.id, input.pageId), eq(examQuestionPaperPageTable.paperId, scope.paperId)))
      .limit(1);
    if (!page) throw rpcError.notFound('Question paper page');
    const image = ({
      thumb: { s3Key: page.thumbS3Key, contentType: 'image/jpeg', fileName: `${page.originalName}.jpg`, disposition: 'inline' },
      model: { s3Key: page.modelS3Key, contentType: page.modelContentType ?? 'image/jpeg', fileName: `${page.originalName}.jpg`, disposition: 'inline' },
      original: { s3Key: page.originalS3Key, contentType: page.contentType, fileName: page.originalName, disposition: 'attachment' },
    } as const)[variant];
    if (!image.s3Key || !image.contentType) throw rpcError.notFound('Question paper page image');
    const url = await pageImageUrl(image.s3Key, { contentType: image.contentType, fileName: image.fileName, disposition: image.disposition });
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': `private, max-age=${QUESTION_PAPER_IMAGE_CACHE_SECONDS}` },
    });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/** How long the browser may keep a version's PDF (a version never changes). */
const VERSION_PDF_CACHE_SECONDS = 60 * 60;

/** The PDF of a saved version, streamed for the paper's screen to draw (pdf.js), as the exam route does. */
export async function handleStandalonePaperVersionPdfRead(
  context: Context,
  rawInput: { ref: unknown; versionNo: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const versionNo = versionNoInputSchema.shape.versionNo.safeParse(Number(rawInput.versionNo));
    if (!/^\d+$/.test(rawInput.versionNo) || !versionNo.success) throw rpcError.notFound('Question paper version');
    const { scope, userId } = await authorize(context, rawInput.ref, 'read');
    const version = await getVersion(context.db, scope.paperId, versionNo.data);
    const s3Key = await storedVersionPdfKey(context.db, { scope, version, userId });
    const { body, byteSize } = await getObjectStream(s3Key);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': `private, max-age=${VERSION_PDF_CACHE_SECONDS}`,
        ...(byteSize === null ? {} : { 'Content-Length': String(byteSize) }),
      },
    });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
