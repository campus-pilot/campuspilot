import {
  ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE,
  ASSISTANT_ATTACHMENTS_PER_MESSAGE,
  attachmentMaxBytesOf,
  type AssistantAttachmentKind,
  type AssistantAttachmentRef,
} from '@campuspilot/assistant-contract/attachments';

import {
  isAcceptedImage,
  type UploadFileInfo,
  type UploadRejection,
} from '../question-paper/question-paper-model';

/**
 * Pure rules of the composer's attachments (images and PDFs): which files may
 * be added, and what the strip and the send button may say about the ones
 * already there. Nothing here touches the DOM or the API.
 */

/** One image or PDF in the composer, from the moment it is picked until the message is sent. */
export type ComposerAttachment = {
  /** Local to the browser; the server id is `ref.id` once uploaded. */
  localId: string;
  /**
   * Image or document: from the file's type while it uploads
   * ({@link attachmentKindOfFile}), then the kind the server decided from the
   * bytes (`ref.kind`), which wins.
   */
  kind: AssistantAttachmentKind;
  fileName: string;
  /** The file's size in bytes, shown on a document tile. */
  byteSize: number;
  /**
   * Images only: a local preview while uploading, then the server thumbnail;
   * null draws a generic tile (HEIC the server cannot decode). Always null for
   * a document, which is never previewed (a PDF is not shown in the browser).
   */
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'failed';
  /** Set when `status` is `ready`. */
  ref: AssistantAttachmentRef | null;
  /** Why it failed, when it did. */
  error: string | null;
};

/** One file of a sent message. `previewUrl` is an image's thumbnail; a document never has one. */
export type SentAttachment = {
  id: string;
  kind: AssistantAttachmentKind;
  fileName: string;
  byteSize: number;
  previewUrl: string | null;
};

/**
 * The tiles of a sent message's files (confirmed, queued or still on its
 * way). Only an image the server decoded (`previewable`) asks for a
 * thumbnail address; a document never does, since its bytes are not served
 * back to a browser, and an undecodable image draws a generic tile.
 */
export const sentAttachmentsOf = (
  refs: readonly AssistantAttachmentRef[],
  previewUrlOf?: (attachment: AssistantAttachmentRef) => string | null,
): SentAttachment[] =>
  refs.map((ref) => ({
    id: ref.id,
    kind: ref.kind,
    fileName: ref.fileName,
    byteSize: ref.byteSize,
    previewUrl: ref.kind === 'image' && ref.previewable ? (previewUrlOf?.(ref) ?? null) : null,
  }));

/** A pick split into the files to upload, each with the kind its type says, and the refused ones with a reason. */
export type AttachmentPlan<F extends UploadFileInfo> = {
  accepted: Array<{ file: F; kind: AssistantAttachmentKind }>;
  rejected: UploadRejection[];
};

const PDF_TYPE = 'application/pdf';
/** Types browsers send for a file they do not recognise; the extension then decides. */
const GENERIC_TYPES = new Set(['', 'application/octet-stream']);

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * Whether a picked file is an accepted attachment, and of which kind, by its
 * declared type (or, when the browser sent a generic one, its extension): the
 * composer's quick check before uploading. The server decides again from the
 * bytes, and its `ref.kind` wins. To decide from the bytes in the browser, the
 * management app has `assistantAttachmentKindOf` (`lib/assistant-attachments`).
 */
export function attachmentKindOfFile(file: Pick<UploadFileInfo, 'name' | 'type'>): AssistantAttachmentKind | null {
  // Named fields, not a spread: a browser `File`'s name and type are prototype getters a spread drops.
  if (isAcceptedImage({ name: file.name, type: file.type, size: 0 })) return 'image';
  const type = file.type.toLowerCase();
  if (type === PDF_TYPE || (GENERIC_TYPES.has(type) && extensionOf(file.name) === 'pdf')) return 'document';
  return null;
}

/** The size refusal for a file of this kind, in whole MB. */
const tooLargeReason = (kind: AssistantAttachmentKind) =>
  `The ${kind === 'document' ? 'PDF' : 'image'} is larger than ${Math.floor(attachmentMaxBytesOf(kind) / 1024 / 1024)} MB.`;

/**
 * Splits picked files into those to upload and those refused with a reason:
 * neither an image nor a PDF (the sentence says to save other documents as
 * PDF), empty, larger than its kind's cap (images 15 MB, PDFs 10 MB), or
 * beyond the message's 20 attachments of either kind (`current` counts every
 * attachment already in the box, uploading or failed ones included, so the
 * message can never hold more than 20). Files keep the order they were
 * picked in.
 */
export function planAttachmentPicks<F extends UploadFileInfo>(files: readonly F[], current: number): AttachmentPlan<F> {
  const accepted: AttachmentPlan<F>['accepted'] = [];
  const rejected: UploadRejection[] = [];
  for (const file of files) {
    const kind = attachmentKindOfFile(file);
    if (!kind) {
      rejected.push({ name: file.name, reason: ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE });
    } else if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'The file is empty.' });
    } else if (file.size > attachmentMaxBytesOf(kind)) {
      rejected.push({ name: file.name, reason: tooLargeReason(kind) });
    } else if (current + accepted.length >= ASSISTANT_ATTACHMENTS_PER_MESSAGE) {
      rejected.push({ name: file.name, reason: `A message can carry at most ${ASSISTANT_ATTACHMENTS_PER_MESSAGE} attachments.` });
    } else {
      accepted.push({ file, kind });
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
    : `${rejected.length} files were not added. ${first!.name}: ${first!.reason}`;
}

/** A file size for a tile: "820 KB", "3.4 MB". */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The files that are stored and will go with the message, in the order shown. */
export const readyAttachments = (items: readonly ComposerAttachment[]): AssistantAttachmentRef[] =>
  items.flatMap((item) => (item.status === 'ready' && item.ref ? [item.ref] : []));

/**
 * What stops a message from being sent because of its attachments, or null:
 * one still uploading (the message would go without it) or one that failed
 * (the user removes it or tries again; it is never dropped silently).
 */
export function attachmentSendBlock(items: readonly ComposerAttachment[]): string | null {
  if (items.some((item) => item.status === 'uploading')) return 'Wait for the attachments to finish uploading';
  if (items.some((item) => item.status === 'failed')) return 'Remove the attachment that could not be uploaded';
  return null;
}

/** Whether there is anything to send: words or at least one stored attachment. */
export const hasMessageContent = (text: string, items: readonly ComposerAttachment[]) =>
  text.trim().length > 0 || readyAttachments(items).length > 0;

/** "1 image", "3 images": the count of an images-only message. */
const imagesOnlyLabel = (count: number) => (count === 1 ? '1 image' : `${count} images`);

/** Text a queued message shows when the user sent only files: "1 image", "2 PDFs", "3 files" for a mix. */
export function attachmentsOnlyLabel(kinds: readonly AssistantAttachmentKind[]): string {
  const documents = kinds.filter((kind) => kind === 'document').length;
  if (documents === 0) return imagesOnlyLabel(kinds.length);
  if (documents === kinds.length) return documents === 1 ? '1 PDF' : `${documents} PDFs`;
  return `${kinds.length} files`;
}

/** A send refused because these stored files are gone from the server; the composer marks their tiles. */
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
 * The tiles after a send found some stored files gone: those become failed
 * tiles with no server reference (so they are never sent again or deleted),
 * telling the user to remove and re-add them; the others stay ready.
 */
export function markMissingAttachments(items: readonly ComposerAttachment[], missingIds: readonly string[]): ComposerAttachment[] {
  const missing = new Set(missingIds);
  return items.map((item) =>
    item.ref && missing.has(item.ref.id)
      ? { ...item, status: 'failed', ref: null, error: 'This file was removed from the server. Remove it and attach it again.' }
      : item,
  );
}
