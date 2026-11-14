import {
  ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE,
  hasPdfSignature,
  PDF_HEADER_SEARCH_BYTES,
  type AssistantAttachmentKind,
} from '@campuspilot/assistant-contract/attachments';
import { hasExpectedImageSignature, hasHeifSignature } from '@campuspilot/s3/image';

/**
 * What a chat attachment is, decided in the browser from the file's leading
 * bytes, in the same order as the upload route (`sniffAttachmentKind` in
 * `@campuspilot/api/files/attachment-upload`): an image signature at offset 0
 * (JPEG, PNG, WebP, HEIC/HEIF) first, so an image is an image whatever it is
 * called; then `%PDF-` within the first {@link PDF_HEADER_SEARCH_BYTES}
 * bytes. Anything else, HTML or a Word file named `.pdf` included, is null.
 *
 * The file name and declared type are never consulted. Pass at least
 * {@link PDF_HEADER_SEARCH_BYTES} leading bytes (fewer only when the file is
 * shorter). The server decides again from the full upload and its `ref.kind`
 * is the fact that is stored; this only keeps a PDF away from the image
 * preparation (HEIC conversion) and refuses other files before they upload.
 */
export function assistantAttachmentKindOfBytes(head: Uint8Array): AssistantAttachmentKind | null {
  if (
    hasExpectedImageSignature(head, 'image/jpeg') ||
    hasExpectedImageSignature(head, 'image/png') ||
    hasExpectedImageSignature(head, 'image/webp') ||
    hasHeifSignature(head)
  ) {
    return 'image';
  }
  return hasPdfSignature(head) ? 'document' : null;
}

/** {@link assistantAttachmentKindOfBytes} for a picked file: reads only its first {@link PDF_HEADER_SEARCH_BYTES} bytes. */
export async function assistantAttachmentKindOf(file: Blob): Promise<AssistantAttachmentKind | null> {
  const head = new Uint8Array(await file.slice(0, PDF_HEADER_SEARCH_BYTES).arrayBuffer());
  return assistantAttachmentKindOfBytes(head);
}

/** A picked file ready to upload, with the kind its bytes say. */
export type PreparedAssistantAttachment = { kind: AssistantAttachmentKind; file: File };

/**
 * Gets a picked file ready to upload as a chat attachment. Its kind comes from
 * its bytes ({@link assistantAttachmentKindOf}). An image goes through
 * `prepareImage` (the composer passes `prepareUploadFile`, which converts HEIC
 * to JPEG where the browser can). A PDF goes up exactly as picked: it is never
 * converted, rendered or read here. Anything else is refused with
 * {@link ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE} before it uploads, the
 * same sentence the server would answer with.
 */
export async function prepareAssistantAttachment(
  file: File,
  prepareImage: (image: File) => Promise<File>,
): Promise<PreparedAssistantAttachment> {
  const kind = await assistantAttachmentKindOf(file);
  if (!kind) throw new Error(ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE);
  return { kind, file: kind === 'image' ? await prepareImage(file) : file };
}
