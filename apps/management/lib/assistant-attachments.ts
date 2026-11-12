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

const apiUrl = (path: string) => new URL(path, env.NEXT_PUBLIC_SERVER_URL).toString();

/**
 * The thumbnail of a chat image, usable as `<img src>`: the session cookie
 * authenticates and the route redirects to a short-lived signed URL. An image
 * the server could not decode (HEIC) has no thumbnail, so callers ask only
 * for `previewable` ones.
 */
export const assistantAttachmentThumbUrl = (schoolId: string, attachmentId: string) =>
  apiUrl(assistantAttachmentReadPath(schoolId, attachmentId, 'thumb'));

/**
 * Uploads one image for the next chat message (multipart field `file`).
 * A refusal comes back as `{ message }`, which becomes the error's message so
 * the composer shows the server's own reason (type, size, assistant access).
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
  return assistantAttachmentRefSchema.parse(await response.json());
}

/**
 * Deletes an image that was uploaded for a message but not sent (the user
 * removed it from the composer), so it stops counting against the cap of
 * unsent images. Removing one that is already gone is not an error.
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
    throw new Error(failure?.message ?? `The image could not be removed (${response.status}).`);
  }
}
