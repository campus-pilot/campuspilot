import { rpcError, rpcErrorResponse } from '@campuspilot/api/errors';
import { parseImageUpload, QUESTION_PAPER_IMAGE_FAMILY } from '@campuspilot/api/files/image-upload';
import {
  pageImageUrl,
  QUESTION_PAPER_IMAGE_CACHE_SECONDS,
} from '@campuspilot/api/routers/school/question-paper/question-paper.storage';
import {
  ASSISTANT_ATTACHMENT_FIELD_NAME,
  ASSISTANT_ATTACHMENT_MAX_BYTES,
} from '@campuspilot/assistant-contract/attachments';
import { assistantAttachmentTable } from '@campuspilot/db/schema/assistant';
import { env } from '@campuspilot/env/server';
import { and, eq } from 'drizzle-orm';

import { assertCanSee, assertCanUse, loadAssistantAccess } from './access';
import { createAttachment } from './attachments';
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
 * Stores one image for the next chat message (multipart field `file`, exactly
 * one file; the composer sends several requests). Checks run in this order and
 * the body is not read before the last one passes: the origin, a browser
 * session (an API key is refused, as for `/model/*`), then the same use
 * access as sending (feature, role, monthly limit). Then the file is read
 * bounded to 15 MiB, type-checked by bytes (JPEG, PNG, WebP, HEIC/HEIF),
 * decoded into a thumbnail and a model copy, and stored unsent.
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
    const upload = await parseImageUpload(request, {
      fieldName: ASSISTANT_ATTACHMENT_FIELD_NAME,
      maxBytes: ASSISTANT_ATTACHMENT_MAX_BYTES,
      subject: 'image',
      family: QUESTION_PAPER_IMAGE_FAMILY,
    });
    const attachment = await createAttachment(db, {
      schoolId,
      userId: session.user.id,
      file: { bytes: upload.bytes, contentType: upload.contentType, extension: upload.extension, name: upload.fileName },
    });
    return Response.json(attachment, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}

/**
 * Redirects the owner of an attachment to a five-minute URL of its image:
 * `thumb` (a JPEG thumbnail, used as `<img src>`) or `original`. Only the
 * user who uploaded it may read it, and only while they may see the assistant
 * in the school. An image the server could not decode has no thumbnail (404);
 * the screen draws a tile instead.
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
    if (!row) throw rpcError.notFound('Attachment');
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
