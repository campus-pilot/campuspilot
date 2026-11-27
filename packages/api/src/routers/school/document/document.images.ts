import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { env } from "@campuspilot/env/server";
import { getS3Client } from "@campuspilot/s3/client";
import {
  hasExpectedImageSignature,
  isSupportedImageMimeType,
  type SupportedImageMimeType,
} from "@campuspilot/s3/image";

/**
 * Images of generated documents (the school logo, student photos) and how
 * they reach a template.
 *
 * A context builder in `reference` mode does not read image bytes: it puts a
 * {@link DocumentImageRef} (the S3 key it read from the database) where the
 * template expects `school.logoUrl` or `student.photoUrl`. Whoever renders
 * then resolves each reference into the string the template prints:
 *
 * - a sample preview: a `data:` URI ({@link documentImageDataUri}), for the
 *   few documents shown only;
 * - a PDF batch: a server-generated file name ({@link documentAssetName},
 *   `asset-<sha256>.<ext>`) that is sent to Gotenberg once per batch as a
 *   form file next to `index.html`. The logo then travels once per batch
 *   instead of once per document, and a photo once.
 *
 * Templates are unchanged: they keep printing `{{school.logoUrl}}` into an
 * `<img src>`. The sanitiser and the CSP accept exactly the generated names
 * of the batch being converted (see `document.render.ts`, "Conversion
 * assets").
 *
 * Resolution is by field, never by looking for strings that resemble a
 * reference: a student's name can hold any text, and it must never be read
 * as a storage key.
 */

/** Largest image a document may carry, checked from the object's size and again from its bytes. */
export const DOCUMENT_IMAGE_MAX_BYTES = 5_000_000;
/**
 * Largest total of distinct image bytes one conversion batch may carry. The
 * batch planner keeps batches under it; a single physical sheet whose images
 * alone exceed it cannot be printed.
 */
export const DOCUMENT_BATCH_IMAGE_MAX_BYTES = 20_000_000;

/** A context image in reference mode: the object key, nothing else. */
export type DocumentImageRef = { documentImageKey: string };

export function documentImageRef(key: string | null): DocumentImageRef | null {
  return key ? { documentImageKey: key } : null;
}

export function isDocumentImageRef(value: unknown): value is DocumentImageRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { documentImageKey?: unknown }).documentImageKey === "string"
  );
}

/**
 * The image fields a document context may hold, by path. Exhaustive: a new
 * image field in a context builder must be added here, or it would reach the
 * template unresolved (and be removed by the sanitiser).
 */
export const DOCUMENT_IMAGE_FIELDS = [
  ["school", "logoUrl"],
  ["student", "photoUrl"],
] as const;
const IMAGE_FIELDS = DOCUMENT_IMAGE_FIELDS;

type ContextRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ContextRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The image keys one context references, in field order (logo first). */
export function contextImageKeys(context: object): string[] {
  const keys: string[] = [];
  for (const [parent, field] of IMAGE_FIELDS) {
    const holder = (context as ContextRecord)[parent];
    if (!isRecord(holder)) continue;
    const value = holder[field];
    if (isDocumentImageRef(value)) keys.push(value.documentImageKey);
  }
  return keys;
}

/**
 * A copy of `context` whose image references are replaced by what
 * `resolve` returns for their key (shallow copies of the holders only). A
 * field that holds anything but a reference is left as it is.
 */
export function withResolvedImages<T extends object>(
  context: T,
  resolve: (key: string) => string | null,
): T {
  const copy: ContextRecord = { ...(context as ContextRecord) };
  for (const [parent, field] of IMAGE_FIELDS) {
    const holder = copy[parent];
    if (!isRecord(holder)) continue;
    const value = holder[field];
    if (isDocumentImageRef(value))
      copy[parent] = { ...holder, [field]: resolve(value.documentImageKey) };
  }
  return copy as T;
}

/**
 * How many characters the embedded images of one context take (the `data:`
 * URIs in its image fields; references and nulls count nothing). A template
 * preview adds a bounded multiple of this to its render budget, so a real
 * school logo of a few megabytes is not refused where the 1 KB sample logo
 * was accepted (docs/document-system.md, "Preview limits").
 */
export function contextImageChars(context: object): number {
  let chars = 0;
  for (const [parent, field] of IMAGE_FIELDS) {
    const holder = (context as ContextRecord)[parent];
    if (!isRecord(holder)) continue;
    const value = holder[field];
    if (typeof value === "string") chars += value.length;
  }
  return chars;
}

/** Why an image cannot be printed; the message is safe to show. */
export class DocumentImageError extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(message);
  }
}

/** File extension of a generated asset name, from the verified content type. */
const ASSET_EXTENSIONS: Record<SupportedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Exactly the names {@link documentAssetName} produces. */
export const DOCUMENT_ASSET_NAME = /^asset-[0-9a-f]{64}\.(?:jpg|png|webp)$/;

/** The longest name {@link documentAssetName} produces, for measuring HTML before images are read. */
export const LONGEST_DOCUMENT_ASSET_NAME = `asset-${"0".repeat(64)}.webp`;

/** The Gotenberg form file name of an image: its content hash and type, never anything the school wrote. */
export function documentAssetName(
  sha256: string,
  contentType: SupportedImageMimeType,
) {
  return `asset-${sha256}.${ASSET_EXTENSIONS[contentType]}`;
}

export type DocumentImageHead = {
  key: string;
  byteSize: number;
  contentType: SupportedImageMimeType;
};

/**
 * Size and type of an image without reading it (for batch planning). Refuses
 * an unsupported type or an image over {@link DOCUMENT_IMAGE_MAX_BYTES}; the
 * bytes are verified again when the batch reads them.
 */
export async function headDocumentImage(key: string): Promise<DocumentImageHead> {
  const head = await getS3Client().send(
    new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (!head.ContentType || !isSupportedImageMimeType(head.ContentType))
    throw new DocumentImageError(key, "is not a PNG, JPEG or WebP image");
  const byteSize = head.ContentLength ?? 0;
  if (byteSize <= 0) throw new DocumentImageError(key, "is empty");
  if (byteSize > DOCUMENT_IMAGE_MAX_BYTES)
    throw new DocumentImageError(key, "is larger than 5 MB");
  return { key, byteSize, contentType: head.ContentType };
}

export type LoadedDocumentImage = {
  key: string;
  contentType: SupportedImageMimeType;
  bytes: Uint8Array;
  sha256: string;
};

/**
 * Reads one image an authorized context builder referenced, directly from
 * S3 (the bucket may be private to the server), with the same checks as
 * the embedded path (`documentImage`): supported type, at most 5 MB, and a
 * signature that matches the type.
 */
export async function loadDocumentImage(key: string): Promise<LoadedDocumentImage> {
  const image = await getS3Client().send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (!image.Body || !image.ContentType || !isSupportedImageMimeType(image.ContentType))
    throw new DocumentImageError(key, "is not a PNG, JPEG or WebP image");
  if (image.ContentLength && image.ContentLength > DOCUMENT_IMAGE_MAX_BYTES)
    throw new DocumentImageError(key, "is larger than 5 MB");
  const bytes = await image.Body.transformToByteArray();
  if (bytes.length > DOCUMENT_IMAGE_MAX_BYTES)
    throw new DocumentImageError(key, "is larger than 5 MB");
  if (!hasExpectedImageSignature(bytes, image.ContentType))
    throw new DocumentImageError(key, "is not a valid image file");
  return {
    key,
    contentType: image.ContentType,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** The image as a `data:` URI, for sample previews only. */
export function documentImageDataUri(image: LoadedDocumentImage) {
  return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

/**
 * Resolves every image reference of `contexts` into a `data:` URI, reading
 * each distinct image once. Used by previews for their sample documents only,
 * so no image of a document outside the sample is read.
 */
export async function embedDocumentImages<T extends object>(contexts: T[]): Promise<T[]> {
  const keys = [...new Set(contexts.flatMap(contextImageKeys))];
  const uris = new Map<string, string>();
  for (const key of keys) uris.set(key, documentImageDataUri(await loadDocumentImage(key)));
  return contexts.map((context) => withResolvedImages(context, (key) => uris.get(key) ?? null));
}
