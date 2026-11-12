import { isHeifFile, QUESTION_PAPER_MAX_PAGE_BYTES } from '@campuspilot/components/question-paper/question-paper-model';

/** The longest edge of a converted photo; the server derives its own sizes from this. */
export const CONVERTED_MAX_EDGE = 4096;
/** JPEG quality of a converted photo. */
export const CONVERTED_QUALITY = 0.92;

/** A photo the browser managed to decode, able to draw itself as a JPEG. */
export type DecodedImage = {
  toJpeg: (maxEdge: number, quality: number) => Promise<Blob | null>;
  close: () => void;
};
/** Decodes a photo, or rejects when this browser cannot (Chrome and Firefox cannot decode HEIC). */
export type ImageDecoder = (file: File) => Promise<DecodedImage>;

export type PreparedUpload = {
  file: File;
  /** True when HEIC was converted to JPEG here; false when the original goes up as it is. */
  converted: boolean;
};

function jpegName(name: string) {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

/**
 * Gets a photo ready to upload (decision D24).
 *
 * JPEG, PNG and WebP go up unchanged. A HEIC/HEIF photo is decoded and redrawn
 * as a JPEG on a canvas where the browser can (Safari); anywhere it cannot, or
 * when anything goes wrong, **the original is uploaded as it is** and the AI
 * model reads it directly. There is no wasm decoder and no server conversion.
 * Conversion never makes things worse: a result that is empty or bigger than
 * the 15 MiB limit is dropped in favour of the original.
 */
export async function prepareUploadFile(file: File, decode: ImageDecoder = browserImageDecoder): Promise<PreparedUpload> {
  if (!isHeifFile(file)) return { file, converted: false };
  let image: DecodedImage | null = null;
  try {
    image = await decode(file);
    const blob = await image.toJpeg(CONVERTED_MAX_EDGE, CONVERTED_QUALITY);
    if (!blob || blob.size === 0 || blob.size > QUESTION_PAPER_MAX_PAGE_BYTES) return { file, converted: false };
    return {
      file: new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified }),
      converted: true,
    };
  } catch {
    return { file, converted: false };
  } finally {
    image?.close();
  }
}

function drawToJpeg(source: CanvasImageSource, width: number, height: number, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function decodeWithImageElement(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    toJpeg: (maxEdge, quality) => drawToJpeg(image, image.naturalWidth, image.naturalHeight, maxEdge, quality),
    close: () => URL.revokeObjectURL(url),
  };
}

/**
 * The browser's own decoders: `createImageBitmap` first (it also applies the
 * photo's orientation), then an `<img>` element. Both reject for HEIC in
 * browsers without HEIC support.
 */
export const browserImageDecoder: ImageDecoder = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        toJpeg: (maxEdge, quality) => drawToJpeg(bitmap, bitmap.width, bitmap.height, maxEdge, quality),
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to the element decoder.
    }
  }
  return decodeWithImageElement(file);
};
