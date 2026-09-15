import { PutObjectCommand } from '@aws-sdk/client-s3';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { getS3Client } from '@campuspilot/s3/client';
import Busboy from 'busboy';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import type { Context } from '../../../context';
import { rpcError, rpcErrorResponse } from '../../../errors';
import { assertPermission } from '../../../permissions/authorization';
import {
  MAX_SCHOOL_LOGO_BYTES,
  SCHOOL_LOGO_EXTENSIONS_BY_MIME_TYPE,
  SCHOOL_LOGO_FIELD_NAME,
  SCHOOL_LOGO_MIME_TYPES,
} from './school.constants';
import { schoolDtoSchema, toSchoolDto } from './school.dto';

type ParsedImage = {
  bytes: Buffer;
  contentType: (typeof SCHOOL_LOGO_MIME_TYPES)[number];
  extension: string;
};

type HttpErrorReporter = (error: unknown) => void;

function hasExpectedImageSignature(image: ParsedImage): boolean {
  const { bytes, contentType } = image;
  if (contentType === 'image/jpeg')
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (contentType === 'image/png') {
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function validatedImageExtension(
  filename: string,
  contentType: ParsedImage['contentType'],
): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  const allowedExtensions: readonly string[] =
    SCHOOL_LOGO_EXTENSIONS_BY_MIME_TYPE[contentType];
  return extension && allowedExtensions.includes(extension)
    ? extension
    : undefined;
}

function parseImageUpload(request: Request): Promise<ParsedImage> {
  if (!request.body)
    throw rpcError.badRequest('A multipart request body is required.');

  return new Promise((resolve, reject) => {
    let fileResult: Promise<ParsedImage> | undefined;
    let fileCount = 0;
    let parser: ReturnType<typeof Busboy>;

    try {
      parser = Busboy({
        headers: Object.fromEntries(request.headers),
        limits: { fileSize: MAX_SCHOOL_LOGO_BYTES, files: 1, fields: 0 },
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

      fileResult = new Promise<ParsedImage>((resolveFile, rejectFile) => {
        if (fieldName !== SCHOOL_LOGO_FIELD_NAME) {
          file.resume();
          rejectFile(
            rpcError.badRequest(
              `The image field must be named '${SCHOOL_LOGO_FIELD_NAME}'.`,
            ),
          );
          return;
        }

        if (
          !SCHOOL_LOGO_MIME_TYPES.includes(
            mimeType as ParsedImage['contentType'],
          )
        ) {
          file.resume();
          rejectFile(
            rpcError.unsupportedMediaType(
              'The logo must be a JPEG, PNG, or WebP image.',
            ),
          );
          return;
        }

        const contentType = mimeType as ParsedImage['contentType'];
        const extension = validatedImageExtension(filename, contentType);
        if (!extension) {
          file.resume();
          rejectFile(
            rpcError.unsupportedMediaType(
              'The logo filename extension must match its image format.',
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
                'The school logo must be 5 MB or smaller.',
              ),
            );
            return;
          }
          resolveFile({
            bytes: Buffer.concat(chunks),
            contentType,
            extension,
          });
        });
      });
      fileResult.catch(() => {});
    });

    parser.on('filesLimit', () => {
      reject(rpcError.badRequest('Upload exactly one school logo.'));
    });
    parser.on('error', reject);
    parser.on('finish', async () => {
      if (fileCount !== 1 || !fileResult) {
        reject(rpcError.badRequest('Upload exactly one school logo.'));
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

/** A Web Request/Response handler with no dependency on Hono or another framework. */
export async function handleSchoolLogoUpload(
  request: Request,
  context: Context,
  schoolId: string,
  reportError?: HttpErrorReporter,
): Promise<Response> {
  try {
    if (!schoolId) throw rpcError.badRequest('A school id is required.');
    await assertPermission(context, {
      action: SCHOOL_ACTIONS.UPDATE_LOGO,
      resource: { kind: 'school', schoolId },
    });

    const [existingSchool] = await context.db
      .select({ id: schoolTable.id })
      .from(schoolTable)
      .where(eq(schoolTable.id, schoolId))
      .limit(1);
    if (!existingSchool) throw rpcError.notFound('School');

    const image = await parseImageUpload(request);
    if (!hasExpectedImageSignature(image)) {
      throw rpcError.unsupportedMediaType(
        'The uploaded file does not match its image format.',
      );
    }
    const logoS3Key = `schools/${schoolId}/logo/${randomUUID()}.${image.extension}`;

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: logoS3Key,
        Body: image.bytes,
        ContentLength: image.bytes.byteLength,
        ContentType: image.contentType,
      }),
    );

    const [school] = await context.db
      .update(schoolTable)
      .set({ logoS3Key, updatedAt: new Date() })
      .where(eq(schoolTable.id, schoolId))
      .returning();
    if (!school) throw rpcError.notFound('School');

    // TODO: Schedule a durable workflow to delete the outdated logo object
    // after its replacement has been committed successfully.

    const dto = schoolDtoSchema.parse(toSchoolDto(school));
    return Response.json(dto);
  } catch (error) {
    reportError?.(error);
    return rpcErrorResponse(error);
  }
}
