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
