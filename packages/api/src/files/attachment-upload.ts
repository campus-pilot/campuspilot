import {
  ASSISTANT_ATTACHMENT_MAX_BYTES,
  ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE,
  ASSISTANT_DOCUMENT_MIME_TYPE,
  attachmentMaxBytesOf,
  hasPdfSignature,
  PDF_HEADER_SEARCH_BYTES,
  type AssistantAttachmentKind,
} from '@campuspilot/assistant-contract/attachments';
import { hasExpectedImageSignature, hasHeifSignature } from '@campuspilot/s3/image';

import { rpcError } from '../errors';
import { parseDocumentUpload } from './document-upload';

/**
 * Chat attachment uploads (the in-app assistant's paperclip): one image or PDF
 * per request, decided by its bytes alone.
 */

/** What an uploaded file is, decided from its bytes. */
export type SniffedAttachment = { kind: AssistantAttachmentKind; contentType: string; extension: string };

/**
 * What an uploaded file is, from its bytes only; the file name and the
 * declared type are never consulted. Image signatures are checked at offset 0
 * first, so an image is an image whatever it is called (a JPEG named `.pdf` is
 * a JPEG); then `%PDF-` at offset 0 or within the first 1,024 bytes, as PDF
 * readers accept (`hasPdfSignature`). Anything else, HTML or a Word file named
 * `.pdf` included, is null and refused. The returned extension is what the
 * storage key uses; the client's name never is.
 */
export function sniffAttachmentKind(bytes: Uint8Array): SniffedAttachment | null {
  if (hasExpectedImageSignature(bytes, 'image/jpeg')) return { kind: 'image', contentType: 'image/jpeg', extension: 'jpg' };
  if (hasExpectedImageSignature(bytes, 'image/png')) return { kind: 'image', contentType: 'image/png', extension: 'png' };
  if (hasExpectedImageSignature(bytes, 'image/webp')) return { kind: 'image', contentType: 'image/webp', extension: 'webp' };
  // HEIC and HEIF brands are not told apart (as for page photos): both are stored as image/heic.
  if (hasHeifSignature(bytes)) return { kind: 'image', contentType: 'image/heic', extension: 'heic' };
  if (hasPdfSignature(bytes.subarray(0, PDF_HEADER_SEARCH_BYTES))) {
    return { kind: 'document', contentType: ASSISTANT_DOCUMENT_MIME_TYPE, extension: 'pdf' };
  }
  return null;
}

export type ParsedAttachmentUpload = SniffedAttachment & {
  bytes: Buffer;
  /** The client's file name, untrusted: a display label after sanitising, never a key, header or path. */
  fileName: string;
};

/** The size refusal for a file of this kind, in whole MB as the composer says it. */
export const attachmentTooLargeMessage = (kind: AssistantAttachmentKind) =>
  `${kind === 'document' ? 'A PDF' : 'An image'} must be ${Math.floor(attachmentMaxBytesOf(kind) / 1024 / 1024)} MB or smaller.`;

/**
 * Parses exactly one multipart file (read bounded to the larger of the two
 * caps), sniffs its kind from the bytes and applies that kind's size cap.
 * A file that is neither an accepted image nor a PDF is a 415 with
 * {@link ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE}; nothing is decoded here.
 */
export async function parseAttachmentUpload(request: Request, options: { fieldName: string }): Promise<ParsedAttachmentUpload> {
  const upload = await parseDocumentUpload(request, {
    fieldName: options.fieldName,
    maxBytes: ASSISTANT_ATTACHMENT_MAX_BYTES,
    subject: 'attachment',
  });
  const sniffed = sniffAttachmentKind(upload.bytes);
  if (!sniffed) throw rpcError.unsupportedMediaType(ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE);
  if (upload.bytes.byteLength > attachmentMaxBytesOf(sniffed.kind)) throw rpcError.payloadTooLarge(attachmentTooLargeMessage(sniffed.kind));
  return { ...sniffed, bytes: upload.bytes, fileName: upload.fileName };
}
