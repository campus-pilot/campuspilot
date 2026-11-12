import sharp from 'sharp';

import { rpcError } from '../errors';

/** Longest edge of the image the AI model reads (design F5). */
const MODEL_EDGE_PX = 1800;
/** Longest edge of the thumbnail shown in the page grid. */
const THUMB_EDGE_PX = 360;
/** The model derivative is re-encoded smaller while it is over this. */
const MODEL_TARGET_BYTES = 600 * 1024;
/**
 * Encodings tried in order for the model derivative: handwriting stays legible
 * at 1500-1800 px, and a 20 page paper must stay well below the providers'
 * request limits. The last entry is kept whatever its size.
 */
const MODEL_ATTEMPTS = [
  { edge: MODEL_EDGE_PX, quality: 82 },
  { edge: MODEL_EDGE_PX, quality: 72 },
  { edge: MODEL_EDGE_PX, quality: 62 },
  { edge: 1500, quality: 62 },
  { edge: 1300, quality: 62 },
  { edge: 1300, quality: 55 },
] as const;
/** Refuses decompression bombs: a small file can declare billions of pixels. */
const MAX_INPUT_PIXELS = 100_000_000;

/** The longest edge and encoding of an uploaded figure (design B6). */
const FIGURE_EDGE_PX = 1400;
const FIGURE_MAX_BYTES = 400 * 1024;

export type ImageDerivatives =
  | {
      status: 'ready';
      /** Width and height after EXIF orientation, as displayed. */
      width: number;
      height: number;
      model: { bytes: Buffer; contentType: 'image/jpeg' };
      thumb: { bytes: Buffer; contentType: 'image/jpeg' };
    }
  | {
      /**
       * sharp could not decode the image (HEIC: the prebuilt libvips has no
       * HEVC decoder, see `image-derivative.test.ts`). The original is still
       * stored; neither derivative exists. The dimensions are what the file
       * header states, when it can be read at all.
       */
      status: 'unsupported';
      width: number | null;
      height: number | null;
    };

const open = (bytes: Uint8Array) =>
  sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });

/** The displayed size of an image from its header; null when the header cannot be read. */
async function headerSize(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await open(bytes).metadata();
    const size = metadata.autoOrient ?? metadata;
    return size.width && size.height ? { width: size.width, height: size.height } : null;
  } catch {
    return null;
  }
}

async function encodeModelDerivative(bytes: Uint8Array) {
  let encoded: Buffer | undefined;
  for (const { edge, quality } of MODEL_ATTEMPTS) {
    encoded = await open(bytes)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (encoded.byteLength <= MODEL_TARGET_BYTES) break;
  }
  return encoded!;
}

/**
 * Decodes an uploaded page photo into the two JPEG derivatives the product
 * needs: a thumbnail for the page grid and a bounded copy for the AI model.
 *
 * Decoding, not reading the header, decides whether an image is supported:
 * the header of a HEIC file can be read by the prebuilt sharp but its pixels
 * cannot be decoded. A JPEG, PNG or WebP that cannot be decoded is the
 * caller's mistake (415); a HEIC/HEIF that cannot is `unsupported`, which is
 * a fact about this server, not about the file.
 */
export async function makeImageDerivatives(
  bytes: Uint8Array,
  contentType: string,
): Promise<ImageDerivatives> {
  const isHeif = contentType === 'image/heic' || contentType === 'image/heif';
  try {
    const [model, thumb, size] = await Promise.all([
      encodeModelDerivative(bytes),
      open(bytes)
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer(),
      headerSize(bytes),
    ]);
    if (!size) throw new Error('The image has no readable size.');
    return {
      status: 'ready',
      ...size,
      model: { bytes: model, contentType: 'image/jpeg' },
      thumb: { bytes: thumb, contentType: 'image/jpeg' },
    };
  } catch (cause) {
    if (!isHeif) {
      throw rpcError.unsupportedMediaType('The uploaded file could not be read as an image.');
    }
    const size = await headerSize(bytes);
    return { status: 'unsupported', width: size?.width ?? null, height: size?.height ?? null };
  }
}

export type NormalizedFigure = {
  bytes: Buffer;
  contentType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
  width: number;
  height: number;
};

/**
 * Normalises an image that will be printed inside a paper: oriented, at most
 * {@link FIGURE_EDGE_PX} px on its longest edge, JPEG (white background) at
 * quality 82. A PNG with transparency stays a PNG when that fits
 * {@link FIGURE_MAX_BYTES}; otherwise it is flattened to JPEG like every other
 * figure. Undecodable input is a 415.
 */
export async function normalizeFigureImage(bytes: Uint8Array): Promise<NormalizedFigure> {
  try {
    const metadata = await open(bytes).metadata();
    const resize = { width: FIGURE_EDGE_PX, height: FIGURE_EDGE_PX, fit: 'inside', withoutEnlargement: true } as const;
    if (metadata.format === 'png' && metadata.hasAlpha) {
      const png = await open(bytes).rotate().resize(resize).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
      if (png.data.byteLength <= FIGURE_MAX_BYTES) {
        return { bytes: png.data, contentType: 'image/png', extension: 'png', width: png.info.width, height: png.info.height };
      }
    }
    for (const quality of [82, 72, 62]) {
      const jpeg = await open(bytes)
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize(resize)
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (jpeg.data.byteLength <= FIGURE_MAX_BYTES || quality === 62) {
        return { bytes: jpeg.data, contentType: 'image/jpeg', extension: 'jpg', width: jpeg.info.width, height: jpeg.info.height };
      }
    }
  } catch {
    // Falls through to the single refusal below.
  }
  throw rpcError.unsupportedMediaType('The uploaded file could not be read as an image.');
}
