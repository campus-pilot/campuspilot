import {
  ASSISTANT_ATTACHMENTS_PER_MESSAGE,
  ASSISTANT_ATTACHMENT_MAX_BYTES,
  type AssistantAttachmentRef,
} from '@campuspilot/assistant-contract/attachments';

import {
  isAcceptedImage,
  type UploadFileInfo,
  type UploadRejection,
} from '../question-paper/question-paper-model';

/**
 * Pure rules of the composer's attachments: which files may be added, and
 * what the strip and the send button may say about the ones already there.
 * Nothing here touches the DOM or the API.
 */

/** One image in the composer, from the moment it is picked until the message is sent. */
export type ComposerAttachment = {
  /** Local to the browser; the server id is `ref.id` once uploaded. */
  localId: string;
  fileName: string;
  /** A local preview while uploading, then the server thumbnail; null draws a generic tile (HEIC the server cannot decode). */
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'failed';
  /** Set when `status` is `ready`. */
  ref: AssistantAttachmentRef | null;
  /** Why it failed, when it did. */
  error: string | null;
};

export type AttachmentPlan<F extends UploadFileInfo> = { accepted: F[]; rejected: UploadRejection[] };

/**
 * Splits picked files into those to upload and those refused with a reason:
 * not an image type, empty, larger than 15 MB, or beyond the message's 20
 * images (`current` counts every attachment already in the box, uploading or
 * failed ones included, so the message can never hold more than 20). Files
 * keep the order they were picked in.
 */
export function planAttachmentPicks<F extends UploadFileInfo>(files: readonly F[], current: number): AttachmentPlan<F> {
  const accepted: F[] = [];
  const rejected: UploadRejection[] = [];
  for (const file of files) {
    if (!isAcceptedImage(file)) {
      rejected.push({ name: file.name, reason: 'Only JPEG, PNG, WebP and HEIC images can be attached.' });
    } else if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'The file is empty.' });
    } else if (file.size > ASSISTANT_ATTACHMENT_MAX_BYTES) {
      rejected.push({ name: file.name, reason: 'The image is larger than 15 MB.' });
    } else if (current + accepted.length >= ASSISTANT_ATTACHMENTS_PER_MESSAGE) {
      rejected.push({ name: file.name, reason: `A message can carry at most ${ASSISTANT_ATTACHMENTS_PER_MESSAGE} images.` });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/** One line for the refusals of a pick, for a toast or the form's error. */
export function rejectionSummary(rejected: readonly UploadRejection[]): string | null {
  if (rejected.length === 0) return null;
  const [first] = rejected;
  return rejected.length === 1
    ? `${first!.name}: ${first!.reason}`
    : `${rejected.length} images were not added. ${first!.name}: ${first!.reason}`;
}

/** The images that are stored and will go with the message, in the order shown. */
export const readyAttachments = (items: readonly ComposerAttachment[]): AssistantAttachmentRef[] =>
  items.flatMap((item) => (item.status === 'ready' && item.ref ? [item.ref] : []));

/**
 * What stops a message from being sent because of its images, or null:
 * an image still uploading (the message would go without it) or one that
 * failed (the user removes it or tries again; it is never dropped silently).
 */
export function attachmentSendBlock(items: readonly ComposerAttachment[]): string | null {
  if (items.some((item) => item.status === 'uploading')) return 'Wait for the images to finish uploading';
  if (items.some((item) => item.status === 'failed')) return 'Remove the image that could not be uploaded';
  return null;
}

/** Whether there is anything to send: words or at least one stored image. */
export const hasMessageContent = (text: string, items: readonly ComposerAttachment[]) =>
  text.trim().length > 0 || readyAttachments(items).length > 0;

/** Text a queued or optimistic message shows when the user sent only images. */
export const imagesOnlyLabel = (count: number) => (count === 1 ? '1 image' : `${count} images`);

/** A send refused because these stored images are gone from the server; the composer marks their tiles. */
export class AttachmentsMissingError extends Error {
  constructor(
    message: string,
    readonly attachmentIds: readonly string[],
  ) {
    super(message);
    this.name = 'AttachmentsMissingError';
  }
}

/**
 * The tiles after a send found some stored images gone: those become failed
 * tiles with no server reference (so they are never sent again or deleted),
 * telling the user to remove and re-add them; the others stay ready.
 */
export function markMissingAttachments(items: readonly ComposerAttachment[], missingIds: readonly string[]): ComposerAttachment[] {
  const missing = new Set(missingIds);
  return items.map((item) =>
    item.ref && missing.has(item.ref.id)
      ? { ...item, status: 'failed', ref: null, error: 'This image was removed from the server. Remove it and attach it again.' }
      : item,
  );
}
