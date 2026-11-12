import {
  hasExpectedImageSignature,
  hasExpectedQuestionPaperImageSignature,
  IMAGE_EXTENSIONS_BY_MIME_TYPE,
  isQuestionPaperImageMimeType,
  isSupportedImageMimeType,
  QUESTION_PAPER_IMAGE_EXTENSIONS,
  type QuestionPaperImageMimeType,
  type SupportedImageMimeType,
} from '@campuspilot/s3/image';
import Busboy from 'busboy';
import { Readable } from 'node:stream';

import { rpcError } from '../errors';

export type ParsedImageUpload<T extends string = SupportedImageMimeType> = {
  bytes: Buffer;
  contentType: T;
  extension: string;
  /** The client's file name, untrusted: for display after sanitising, never for a storage key. */
  fileName: string;
};

/**
 * Which image formats an upload route accepts. Every format states its media
 * type, its filename extensions and how to recognise its bytes, so a route
 * opts into more formats (question paper photos accept HEIC) without
 * widening any other route.
 */
export type ImageFamily<T extends string> = {
  isSupported: (mimeType: string) => mimeType is T;
  extensions: Readonly<Record<T, readonly string[]>>;
  hasSignature: (bytes: Uint8Array, contentType: T) => boolean;
  /** Completes "The {subject} must be ..." in the unsupported-format message. */
  description: string;
  /**
   * The media type to use when the browser sent a generic or empty one for a
   * file whose extension names a supported format. The signature check still
   * decides whether the bytes are really that format.
   */
  inferMimeType?: (mimeType: string, extension: string | undefined) => T | undefined;
};

/** JPEG, PNG and WebP: the default of every upload route. */
export const STANDARD_IMAGE_FAMILY: ImageFamily<SupportedImageMimeType> = {
  isSupported: isSupportedImageMimeType,
  extensions: IMAGE_EXTENSIONS_BY_MIME_TYPE,
  hasSignature: hasExpectedImageSignature,
  description: 'a JPEG, PNG, or WebP image',
};

/** Media types browsers send for a file they do not recognise (iOS and Windows do so for HEIC). */
const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream', 'text/plain']);

/** Question paper page photos: JPEG, PNG, WebP and the HEIC/HEIF family. */
export const QUESTION_PAPER_IMAGE_FAMILY: ImageFamily<QuestionPaperImageMimeType> = {
  isSupported: isQuestionPaperImageMimeType,
  extensions: QUESTION_PAPER_IMAGE_EXTENSIONS,
  hasSignature: hasExpectedQuestionPaperImageSignature,
  description: 'a JPEG, PNG, WebP, HEIC, or HEIF image',
  inferMimeType: (mimeType, extension) =>
    GENERIC_MIME_TYPES.has(mimeType.toLowerCase()) && (extension === 'heic' || extension === 'heif')
      ? 'image/heic'
      : undefined,
};

type ImageUploadOptions<T extends string> = {
  fieldName: string;
  maxBytes: number;
  subject: string;
  /** Accepted formats; JPEG, PNG and WebP when omitted. */
  family?: ImageFamily<T>;
};

function filenameExtension(filename: string): string | undefined {
  return /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
}

function validatedImageExtension<T extends string>(
  filename: string,
  contentType: T,
  family: ImageFamily<T>,
): string | undefined {
  const extension = filenameExtension(filename);
  const allowedExtensions: readonly string[] = family.extensions[contentType];
  return extension && allowedExtensions.includes(extension)
    ? extension
    : undefined;
}

/**
 * Parses exactly one bounded image multipart file (JPEG, PNG, or WebP unless
 * `options.family` names other formats). The declared media type, the
 * filename extension and the encoded file signature must agree.
 */
export function parseImageUpload(
  request: Request,
  options: ImageUploadOptions<SupportedImageMimeType>,
): Promise<ParsedImageUpload>;
export function parseImageUpload<T extends string>(
  request: Request,
  options: ImageUploadOptions<T> & { family: ImageFamily<T> },
): Promise<ParsedImageUpload<T>>;
export function parseImageUpload<T extends string>(
  request: Request,
  options: ImageUploadOptions<T>,
): Promise<ParsedImageUpload<T>> {
  const family = (options.family ?? STANDARD_IMAGE_FAMILY) as ImageFamily<T>;
  if (!request.body) {
    throw rpcError.badRequest('A multipart request body is required.');
  }

  return new Promise((resolve, reject) => {
    let fileResult: Promise<ParsedImageUpload<T>> | undefined;
    let fileCount = 0;
    let parser: ReturnType<typeof Busboy>;

    try {
      parser = Busboy({
        headers: Object.fromEntries(request.headers),
        limits: { fileSize: options.maxBytes, files: 1, fields: 0 },
      });
    } catch (error) {
      reject(
        rpcError.badRequest(
          'A valid multipart/form-data request is required.',
          error,
        ),
      );
      return;
    }

    parser.on('file', (fieldName, file, { filename, mimeType }) => {
      fileCount += 1;
      const chunks: Buffer[] = [];
      let exceededLimit = false;

      fileResult = new Promise<ParsedImageUpload<T>>((resolveFile, rejectFile) => {
        if (fieldName !== options.fieldName) {
          file.resume();
          rejectFile(
            rpcError.badRequest(
              `The image field must be named '${options.fieldName}'.`,
            ),
          );
          return;
        }

        const declaredType = family.isSupported(mimeType)
          ? mimeType
          : family.inferMimeType?.(mimeType, filenameExtension(filename));
        if (declaredType === undefined) {
          file.resume();
          rejectFile(
            rpcError.unsupportedMediaType(
              `The ${options.subject} must be ${family.description}.`,
            ),
          );
          return;
        }

        const extension = validatedImageExtension(filename, declaredType, family);
        if (!extension) {
          file.resume();
          rejectFile(
            rpcError.unsupportedMediaType(
              `The ${options.subject} filename extension must match its image format.`,
            ),
          );
          return;
        }

        file.on('limit', () => {
          exceededLimit = true;
        });
        file.on('data', (chunk: Buffer) => chunks.push(chunk));
        file.on('error', rejectFile);
        file.on('end', () => {
          if (exceededLimit) {
            rejectFile(
              rpcError.payloadTooLarge(
                `The ${options.subject} must be ${Math.floor(options.maxBytes / 1024 / 1024)} MB or smaller.`,
              ),
            );
            return;
          }

          const bytes = Buffer.concat(chunks);
          if (!family.hasSignature(bytes, declaredType)) {
            rejectFile(
              rpcError.unsupportedMediaType(
                'The uploaded file does not match its image format.',
              ),
            );
            return;
          }
          resolveFile({ bytes, contentType: declaredType, extension, fileName: filename });
        });
      });
      fileResult.catch(() => {});
    });

    parser.on('filesLimit', () => {
      reject(rpcError.badRequest(`Upload exactly one ${options.subject}.`));
    });
    parser.on('fieldsLimit', () => {
      reject(rpcError.badRequest('Additional form fields are not allowed.'));
    });
    parser.on('error', reject);
    parser.on('finish', async () => {
      if (fileCount !== 1 || !fileResult) {
        reject(rpcError.badRequest(`Upload exactly one ${options.subject}.`));
        return;
      }

      try {
        resolve(await fileResult);
      } catch (error) {
        reject(error);
      }
    });

    Readable.from(request.body as AsyncIterable<Uint8Array>).pipe(parser);
  });
}
