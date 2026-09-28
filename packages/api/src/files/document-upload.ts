import Busboy from 'busboy';
import { Readable } from 'node:stream';

import { rpcError } from '../errors';

export type ParsedDocumentUpload = {
  bytes: Buffer;
  contentType: string;
  fileName: string;
};

/** Parses exactly one bounded multipart file without trusting its media type. */
export function parseDocumentUpload(
  request: Request,
  options: { fieldName: string; maxBytes: number },
): Promise<ParsedDocumentUpload> {
  if (!request.body) {
    throw rpcError.badRequest('A multipart request body is required.');
  }

  return new Promise((resolve, reject) => {
    let fileResult: Promise<ParsedDocumentUpload> | undefined;
    let fileCount = 0;
    let parser: ReturnType<typeof Busboy>;

    try {
      parser = Busboy({
        headers: Object.fromEntries(request.headers),
        limits: { fileSize: options.maxBytes, files: 1, fields: 0 },
      });
    } catch (error) {
      reject(rpcError.badRequest('A valid multipart/form-data request is required.', error));
      return;
    }

    parser.on('file', (fieldName, file, { filename, mimeType }) => {
      fileCount += 1;
      const chunks: Buffer[] = [];
      let exceededLimit = false;
      fileResult = new Promise((resolveFile, rejectFile) => {
        if (fieldName !== options.fieldName) {
          file.resume();
          rejectFile(rpcError.badRequest(`The document field must be named '${options.fieldName}'.`));
          return;
        }
        const fileName = filename.trim();
        if (!fileName || fileName.length > 255) {
          file.resume();
          rejectFile(rpcError.badRequest('The document filename must be between 1 and 255 characters.'));
          return;
        }
        file.on('limit', () => { exceededLimit = true; });
        file.on('data', (chunk: Buffer) => chunks.push(chunk));
        file.on('error', rejectFile);
        file.on('end', () => {
          if (exceededLimit) {
            rejectFile(rpcError.payloadTooLarge(`Each admission document must be ${Math.floor(options.maxBytes / 1024 / 1024)} MB or smaller.`));
            return;
          }
          const bytes = Buffer.concat(chunks);
          if (bytes.byteLength === 0) {
            rejectFile(rpcError.badRequest('The admission document cannot be empty.'));
            return;
          }
          resolveFile({
            bytes,
            fileName,
            contentType: mimeType.trim() || 'application/octet-stream',
          });
        });
      });
      fileResult.catch(() => {});
    });

    parser.on('filesLimit', () => reject(rpcError.badRequest('Upload exactly one admission document.')));
    parser.on('fieldsLimit', () => reject(rpcError.badRequest('Additional form fields are not allowed.')));
    parser.on('error', reject);
    parser.on('finish', async () => {
      if (fileCount !== 1 || !fileResult) {
        reject(rpcError.badRequest('Upload exactly one admission document.'));
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
