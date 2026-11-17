'use client';

import {
  assistantAttachmentDeletePath,
  assistantAttachmentReadPath,
  assistantAttachmentRefSchema,
  assistantAttachmentUploadPath,
  ASSISTANT_ATTACHMENT_FIELD_NAME,
  type AssistantAttachmentRef,
} from '@campuspilot/assistant-contract/attachments';
import { env } from '@campuspilot/env/management.client';

import { AttachmentNotProcessedError, waitUntilProcessed } from '@/components/assistant/attachment-readiness';

/** Decide a picked file's kind from its first bytes; kept in their own module so they are testable without the app's environment. */
export {
  assistantAttachmentKindOf,
  assistantAttachmentKindOfBytes,
  prepareAssistantAttachment,
  type PreparedAssistantAttachment,
} from './assistant-attachment-kind';

const apiUrl = (path: string) => new URL(path, env.NEXT_PUBLIC_SERVER_URL).toString();

/**
 * The thumbnail of a chat image, usable as `<img src>`: the session cookie
 * authenticates and the route redirects to a short-lived signed URL. An image
 * the server could not decode (HEIC) has no thumbnail, and a document never
 * has one (the route refuses it: a PDF's bytes are never served back to a
 * browser), so callers ask only for `previewable` images.
 */
export const assistantAttachmentThumbUrl = (schoolId: string, attachmentId: string) =>
  apiUrl(assistantAttachmentReadPath(schoolId, attachmentId, 'thumb'));

/** Reads the current reference of one unsent attachment (its `derivativeStatus` changes once the worker made its copies). */
async function readAssistantAttachment(schoolId: string, attachmentId: string): Promise<AssistantAttachmentRef> {
  let response: Response;
  try {
    response = await fetch(apiUrl(assistantAttachmentDeletePath(schoolId, attachmentId)), { credentials: 'include', cache: 'no-store' });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(failure?.message ?? `The file could not be checked (${response.status}).`);
  }
  return assistantAttachmentRefSchema.parse(await response.json());
}

/**
 * The original of a chat image, at full size: `<img src>` in the image viewer
 * and the viewer's download link (the route answers with
 * `Content-Disposition: attachment`, which an `<img>` ignores and a followed
 * link saves). Same access and redirect as the thumbnail, and likewise asked
 * only for `previewable` images.
 */
export const assistantAttachmentOriginalUrl = (schoolId: string, attachmentId: string) =>
  apiUrl(assistantAttachmentReadPath(schoolId, attachmentId, 'original'));

/**
 * Uploads one file, an image or a PDF, for the next chat message of this
 * school (multipart field `file`), exactly as given: no conversion here (the
 * composer's `useAssistantAttachmentUpload` shrinks photos first). The
 * server decides the kind from the bytes and answers with the stored
 * reference, whose `kind` is the fact to use. An image's thumbnail and model
 * copy are made by the worker afterwards, so this resolves only once they
 * exist (`waitUntilProcessed`): a message is never sent with an unprocessed
 * image. An image the server could not read is removed again and rejected
 * with a sentence saying so. A refusal comes back as `{ message }`, which
 * becomes the error's message so the composer shows the server's own reason
 * (type, size, assistant access).
 */
export async function uploadAssistantAttachment(schoolId: string, file: File): Promise<AssistantAttachmentRef> {
  const body = new FormData();
  body.set(ASSISTANT_ATTACHMENT_FIELD_NAME, file);
  let response: Response;
  try {
    response = await fetch(apiUrl(assistantAttachmentUploadPath(schoolId)), { method: 'POST', body, credentials: 'include' });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(failure?.message ?? `The upload failed (${response.status}).`);
  }
  const stored = assistantAttachmentRefSchema.parse(await response.json());
  try {
    return await waitUntilProcessed(stored, (attachmentId) => readAssistantAttachment(schoolId, attachmentId));
  } catch (error) {
    // An image that will not be usable must not keep counting against the user's unsent files.
    if (error instanceof AttachmentNotProcessedError) await deleteAssistantAttachment(schoolId, stored.id).catch(() => undefined);
    throw error;
  }
}

/**
 * Deletes an image or PDF that was uploaded for a message but not sent (the
 * user removed it from the composer), so it stops counting against the cap of
 * unsent attachments. Removing one that is already gone is not an error.
 */
export async function deleteAssistantAttachment(schoolId: string, attachmentId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(apiUrl(assistantAttachmentDeletePath(schoolId, attachmentId)), { method: 'DELETE', credentials: 'include' });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(failure?.message ?? `The file could not be removed (${response.status}).`);
  }
}
