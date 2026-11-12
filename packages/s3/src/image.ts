export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type SupportedImageMimeType =
  (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export const IMAGE_EXTENSIONS_BY_MIME_TYPE = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
} as const satisfies Record<SupportedImageMimeType, readonly string[]>;

export function isSupportedImageMimeType(
  value: string,
): value is SupportedImageMimeType {
  return SUPPORTED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);
}

/** Verifies the encoded bytes instead of trusting multipart or remote headers. */
export function hasExpectedImageSignature(
  bytes: Uint8Array,
  contentType: SupportedImageMimeType,
): boolean {
  if (contentType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  }
  if (contentType === 'image/png') {
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return pngSignature.every((value, index) => bytes[index] === value);
  }
  return (
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  );
}

/**
 * Question paper page photos also accept the HEIC/HEIF family that phones
 * produce. These are a separate list: profile photos, school logos and
 * admission photos stay JPEG, PNG and WebP only.
 */
export const QUESTION_PAPER_IMAGE_MIME_TYPES = [
  ...SUPPORTED_IMAGE_MIME_TYPES,
  'image/heic',
  'image/heif',
] as const;

export type QuestionPaperImageMimeType =
  (typeof QUESTION_PAPER_IMAGE_MIME_TYPES)[number];

/**
 * Both HEIC media types accept both extensions: platforms disagree on which
 * pair they send (iOS `image/heic` + `.heic`, some Android and Windows
 * exports `image/heif` + `.heic`). The signature check below does not tell
 * the two apart either, so neither does this list.
 */
export const QUESTION_PAPER_IMAGE_EXTENSIONS = {
  ...IMAGE_EXTENSIONS_BY_MIME_TYPE,
  'image/heic': ['heic', 'heif'],
  'image/heif': ['heif', 'heic'],
} as const satisfies Record<QuestionPaperImageMimeType, readonly string[]>;

export function isQuestionPaperImageMimeType(
  value: string,
): value is QuestionPaperImageMimeType {
  return QUESTION_PAPER_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);
}

/** Whether a media type is one of the HEIC/HEIF family. */
export function isHeifMimeType(value: string): value is 'image/heic' | 'image/heif' {
  return value === 'image/heic' || value === 'image/heif';
}

/** ISO-BMFF brands that identify a HEVC (HEIC) or generic HEIF still image. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
/** AVIF is also an ISO-BMFF image and also lists `mif1`; it is not accepted. */
const AVIF_BRANDS = new Set(['avif', 'avis']);

/**
 * HEIC/HEIF files are ISO base media files: a 4-byte box size, `ftyp`, the
 * major brand, a minor version and then compatible brands up to the end of
 * the `ftyp` box. The file is accepted when the major brand or any compatible
 * brand is a HEIF brand and no brand says AVIF (an AVIF file lists `mif1`
 * too, so a HEIF brand alone does not prove it is not one).
 */
export function hasHeifSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(4, 8) !== 'ftyp') return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  // A box of size 1 has a 64-bit size and 0 runs to the end; neither occurs for ftyp of a photo.
  if (boxSize < 16 || boxSize > 512 || boxSize > bytes.length) return false;
  const brands = [ascii(8, 12)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(ascii(offset, offset + 4));
  if (brands.some((brand) => AVIF_BRANDS.has(brand.toLowerCase()))) return false;
  return brands.some((brand) => HEIF_BRANDS.has(brand.toLowerCase()));
}

/** Like {@link hasExpectedImageSignature}, for every question paper image type. */
export function hasExpectedQuestionPaperImageSignature(
  bytes: Uint8Array,
  contentType: QuestionPaperImageMimeType,
): boolean {
  return isHeifMimeType(contentType)
    ? hasHeifSignature(bytes)
    : hasExpectedImageSignature(bytes, contentType);
}
