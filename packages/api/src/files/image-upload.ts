import {
  hasExpectedImageSignature,
  IMAGE_EXTENSIONS_BY_MIME_TYPE,
  isSupportedImageMimeType,
  type SupportedImageMimeType,
} from '@campuspilot/s3/image';
import Busboy from 'busboy';
import { Readable } from 'node:stream';

import { rpcError } from '../errors';

export type ParsedImageUpload = {
  bytes: Buffer;
  contentType: SupportedImageMimeType;
  extension: string;
};

type ImageUploadOptions = {
  fieldName: string;
  maxBytes: number;
  subject: string;
};

function validatedImageExtension(
  filename: string,
  contentType: SupportedImageMimeType,
): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  const allowedExtensions: readonly string[] =
    IMAGE_EXTENSIONS_BY_MIME_TYPE[contentType];
  return extension && allowedExtensions.includes(extension)
    ? extension
    : undefined;
}

/**
 * Parses exactly one bounded JPEG, PNG, or WebP multipart file. Both the
 * declared media type and the encoded file signature must agree.
 */
export function parseImageUpload(
  request: Request,
  options: ImageUploadOptions,
): Promise<ParsedImageUpload> {
  if (!request.body) {
    throw rpcError.badRequest('A multipart request body is required.');
  }

  return new Promise((resolve, reject) => {
    let fileResult: Promise<ParsedImageUpload> | undefined;
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

      fileResult = new Promise<ParsedImageUpload>((resolveFile, rejectFile) => {
        if (fieldName !== options.fieldName) {
          file.resume();
          rejectFile(
            rpcError.badRequest(
              `The image field must be named '${options.fieldName}'.`,
            ),
          );
          return;
        }

        if (!isSupportedImageMimeType(mimeType)) {
          file.resume();
          rejectFile(
            rpcError.unsupportedMediaType(
              `The ${options.subject} must be a JPEG, PNG, or WebP image.`,
            ),
          );
          return;
        }

        const extension = validatedImageExtension(filename, mimeType);
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
          if (!hasExpectedImageSignature(bytes, mimeType)) {
            rejectFile(
              rpcError.unsupportedMediaType(
                'The uploaded file does not match its image format.',
              ),
            );
            return;
          }
          resolveFile({ bytes, contentType: mimeType, extension });
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
