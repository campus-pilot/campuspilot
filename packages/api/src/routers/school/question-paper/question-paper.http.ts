import { examQuestionPaperPageTable } from '@campuspilot/db/schema/exam-question-paper';
import { CLASS_ACTIONS } from '@campuspilot/opa/policies/class';
import { and, eq } from 'drizzle-orm';

import type { Context } from '../../../context';
import { rpcError, rpcErrorResponse } from '../../../errors';
import { parseImageUpload, QUESTION_PAPER_IMAGE_FAMILY } from '../../../files/image-upload';
import { assertPermission } from '../../../permissions/authorization';
import { assertQuestionPaperAssistantAccess } from './question-paper.access';
import { paperKeySchema, QUESTION_PAPER_MAX_PAGE_BYTES, type PaperKey } from './question-paper.dto';
import { findPaper } from './question-paper.records';
import { assertPaperWritable, resolvePaperScope } from './question-paper.scope';
import { addQuestionPaperPage } from './question-paper.service';
import { pageImageUrl, QUESTION_PAPER_IMAGE_CACHE_SECONDS } from './question-paper.storage';

/** The multipart field of an uploaded page photo. */
export const QUESTION_PAPER_PAGE_FIELD_NAME = 'page';
type HttpErrorReporter = (error: unknown) => void;

function parseKey(input: unknown): PaperKey {
  const parsed = paperKeySchema.safeParse(input);
  if (!parsed.success) throw rpcError.badRequest('The school, session, exam, class, subject and mode are required.');
  return parsed.data;
}

function requireUser(context: Context): string {
  const id = context.session?.user.id;
  if (!id) throw rpcError.unauthorized();
  return id;
}

/**
 * Adds one page photo to a paper (multipart, field `page`, exactly one
 * file). Checks run in this order and the body is not read before the last
 * one passes: the caller may manage this class's papers (OPA), the school and
 * the caller's role may use the AI assistant, the key names a real plan and
 * mode, and the exam accepts changes. Only then is the file read, bounded and
 * type-checked (JPEG, PNG, WebP, HEIC), derivatives are made and the page is
 * stored under the paper row lock (20 page cap, no running generation).
 */
export async function handleQuestionPaperPageUpload(
  request: Request,
  context: Context,
  rawKey: unknown,
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const key = parseKey(rawKey);
    await assertPermission(context, {
      action: CLASS_ACTIONS.MANAGE_EXAM_QUESTION_PAPERS,
      resource: { kind: 'class', schoolId: key.schoolId, classId: key.classId },
    });
    const userId = requireUser(context);
    await assertQuestionPaperAssistantAccess(context.db, { schoolId: key.schoolId, userId });
    const scope = await resolvePaperScope(context.db, key);
    // The same refusal the write itself makes, but before a 15 MB body is read.
    assertPaperWritable(scope);
    const upload = await parseImageUpload(request, {
      fieldName: QUESTION_PAPER_PAGE_FIELD_NAME,
      maxBytes: QUESTION_PAPER_MAX_PAGE_BYTES,
      subject: 'page',
      family: QUESTION_PAPER_IMAGE_FAMILY,
    });
    const result = await addQuestionPaperPage(context.db, {
      scope,
      userId,
      file: { bytes: upload.bytes, contentType: upload.contentType, extension: upload.extension, name: upload.fileName },
    });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/**
 * Redirects a permissioned request to a five-minute URL of a page image:
 * `thumb` (320-360 px JPEG, used as `<img src>`) or `original` (the uploaded
 * file, as a download). A page the server could not decode has no thumbnail
 * (404); the screen draws a tile instead.
 */
export async function handleQuestionPaperPageRead(
  context: Context,
  rawKey: unknown,
  input: { pageId: string; variant: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    const key = parseKey(rawKey);
    if (input.variant !== 'thumb' && input.variant !== 'original') throw rpcError.notFound('Question paper page');
    await assertPermission(context, {
      action: CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS,
      resource: { kind: 'class', schoolId: key.schoolId, classId: key.classId },
    });
    await assertQuestionPaperAssistantAccess(context.db, { schoolId: key.schoolId, userId: requireUser(context) });
    const paper = await findPaper(context.db, key);
    if (!paper) throw rpcError.notFound('Question paper page');
    const [page] = await context.db
      .select()
      .from(examQuestionPaperPageTable)
      .where(and(eq(examQuestionPaperPageTable.id, input.pageId), eq(examQuestionPaperPageTable.paperId, paper.id)))
      .limit(1);
    if (!page) throw rpcError.notFound('Question paper page');
    const thumb = input.variant === 'thumb';
    const s3Key = thumb ? page.thumbS3Key : page.originalS3Key;
    if (!s3Key) throw rpcError.notFound('Question paper page image');
    const url = await pageImageUrl(s3Key, {
      contentType: thumb ? 'image/jpeg' : page.contentType,
      fileName: thumb ? `${page.originalName}.jpg` : page.originalName,
      disposition: thumb ? 'inline' : 'attachment',
    });
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': `private, max-age=${QUESTION_PAPER_IMAGE_CACHE_SECONDS}` },
    });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
