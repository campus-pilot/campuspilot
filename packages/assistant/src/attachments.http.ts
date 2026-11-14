import { rpcError, rpcErrorResponse } from '@campuspilot/api/errors';
import { parseAttachmentUpload } from '@campuspilot/api/files/attachment-upload';
import {
  pageImageUrl,
  QUESTION_PAPER_IMAGE_CACHE_SECONDS,
} from '@campuspilot/api/routers/school/question-paper/question-paper.storage';
import { ASSISTANT_ATTACHMENT_FIELD_NAME } from '@campuspilot/assistant-contract/attachments';
import { assistantAttachmentTable } from '@campuspilot/db/schema/assistant';
import { env } from '@campuspilot/env/server';
import { and, eq } from 'drizzle-orm';

import { assertCanSee, assertCanUse, loadAssistantAccess } from './access';
import { createAttachment, deleteUnsentAttachment } from './attachments';
import { db } from './db';
import { resolveAssistantSession, type AssistantSession } from './session';

type HttpErrorReporter = (error: unknown) => void;

/** Same rule as the `/model/rpc` handler: a request naming a foreign origin never runs. */
function assertAllowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin === null) return;
  const allowed = new Set(env.CORS_ORIGIN.split(',').map((value) => value.trim()));
  if (!allowed.has(origin)) throw rpcError.forbidden('This request came from an origin that is not allowed.');
}

async function requireSession(headers: Headers): Promise<AssistantSession> {
  const session = await resolveAssistantSession(headers);
  if (!session) throw rpcError.unauthorized();
  return session;
}

/**
 * Stores one image or PDF for the next chat message (multipart field `file`,
 * exactly one file; the composer sends several requests). Checks run in this
 * order and the body is not read before the last one passes: the origin, a
 * browser session (an API key is refused, as for `/model/*`), then the same
 * use access as sending (feature, role, monthly limit). Then the file is read
 * bounded to 15 MiB and its kind is decided by its bytes alone (JPEG, PNG,
 * WebP, HEIC/HEIF, or `%PDF-`; never the name or declared type). An image is
 * decoded into a thumbnail and a model copy and capped at 15 MiB; a PDF is
 * capped at 10 MiB and stored as it is (never parsed or rendered). Anything
 * else is a 415 that says to save documents as PDF.
 */
export async function handleAssistantAttachmentUpload(
  request: Request,
  schoolId: string,
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    assertAllowedOrigin(request);
    const session = await requireSession(request.headers);
    assertCanUse(await loadAssistantAccess(session, schoolId));
    const upload = await parseAttachmentUpload(request, { fieldName: ASSISTANT_ATTACHMENT_FIELD_NAME });
    const attachment = await createAttachment(db, {
      schoolId,
      userId: session.user.id,
      file: { bytes: upload.bytes, kind: upload.kind, contentType: upload.contentType, extension: upload.extension, name: upload.fileName },
    });
    return Response.json(attachment, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/**
 * Redirects the owner of an image attachment to a five-minute URL of it:
 * `thumb` (a JPEG thumbnail, used as `<img src>`) or `original`. Only the
 * user who uploaded it may read it, and only while they may see the assistant
 * in the school. An image the server could not decode has no thumbnail (404);
 * the screen draws a tile instead.
 *
 * A document is never served, in either variant (404): a PDF can carry script
 * and a browser renders it inline, so its bytes go to the model and nowhere
 * else. The screen shows a document as a tile with its name and size.
 */
export async function handleAssistantAttachmentRead(
  headers: Headers,
  input: { schoolId: string; attachmentId: string; variant: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    if (input.variant !== 'thumb' && input.variant !== 'original') throw rpcError.notFound('Attachment');
    const session = await requireSession(headers);
    assertCanSee(await loadAssistantAccess(session, input.schoolId));
    const [row] = await db
      .select()
      .from(assistantAttachmentTable)
      .where(
        and(
          eq(assistantAttachmentTable.id, input.attachmentId),
          eq(assistantAttachmentTable.schoolId, input.schoolId),
          eq(assistantAttachmentTable.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!row || row.kind !== 'image') throw rpcError.notFound('Attachment');
    const thumb = input.variant === 'thumb';
    const key = thumb ? row.thumbS3Key : row.s3Key;
    if (!key) throw rpcError.notFound('Attachment image');
    const url = await pageImageUrl(key, {
      contentType: thumb ? 'image/jpeg' : row.contentType,
      fileName: thumb ? `${row.originalName}.jpg` : row.originalName,
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

/**
 * Removes one file the caller attached but has not sent (the composer's
 * remove button; the 40 unsent files a user may hold count until then).
 * Origin, browser session and the right to see the assistant are checked like
 * a read, not like an upload: taking an image back must still work for a
 * school over its monthly limit. Only the owner's own unsent file goes; one
 * already sent is a CONFLICT, and one that is not there answers
 * `{ deleted: false }`.
 */
export async function handleAssistantAttachmentDelete(
  request: Request,
  input: { schoolId: string; attachmentId: string },
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    assertAllowedOrigin(request);
    const session = await requireSession(request.headers);
    assertCanSee(await loadAssistantAccess(session, input.schoolId));
    const result = await deleteUnsentAttachment(db, {
      schoolId: input.schoolId,
      userId: session.user.id,
      attachmentId: input.attachmentId,
    });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
