/**
 * Image facts the Word (.docx) conversion needs without decoding a picture:
 * the type from the bytes' signature and the pixel size from the header.
 * Pure and bounded (a JPEG's markers are walked at most
 * {@link MAX_JPEG_SEGMENTS} times); anything unreadable is null and the image
 * is then left out, never guessed.
 */

export type DocxImageType = 'image/png' | 'image/jpeg' | 'image/webp';
export type ImageSize = { width: number; height: number };

const MAX_JPEG_SEGMENTS = 512;
/** The largest side an image may claim; larger headers are treated as unreadable. */
const MAX_SIDE = 40_000;

/** The type a picture's bytes say it is (PNG, JPEG or WebP), or null. */
export function imageTypeOf(bytes: Uint8Array): DocxImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16be = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
const u32be = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
const u24le = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);

const sane = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE ? { width, height } : null;

/** The pixel size an image's header states, or null when the header cannot be read. */
export function imageSizeOf(bytes: Uint8Array): ImageSize | null {
  const type = imageTypeOf(bytes);
  if (type === 'image/png') return bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR' ? sane(u32be(bytes, 16), u32be(bytes, 20)) : null;
  if (type === 'image/jpeg') return jpegSize(bytes);
  if (type === 'image/webp') return webpSize(bytes);
  return null;
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2;
  for (let segment = 0; segment < MAX_JPEG_SEGMENTS && at + 9 < bytes.length; segment += 1) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // SOF0-SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return sane(u16be(bytes, at + 7), u16be(bytes, at + 5));
    }
    const length = u16be(bytes, at + 2);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') return sane(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  if (chunk === 'VP8L') {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return sane((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ') return sane(((bytes[26]! | (bytes[27]! << 8)) & 0x3fff), ((bytes[28]! | (bytes[29]! << 8)) & 0x3fff));
  return null;
}

/**
 * The bytes of a base64 data URI of a PNG, JPEG or WebP image whose bytes
 * agree with the type it names, or null. Only `data:` images are ever read:
 * no URL reaches the converter.
 */
export function dataUriImage(value: string): { type: DocxImageType; bytes: Buffer } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2]!, 'base64');
  const type = imageTypeOf(bytes);
  return type === match[1] ? { type, bytes } : null;
}
