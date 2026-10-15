import { createHash } from 'node:crypto';
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client } from '@campuspilot/s3/client';
import {
  hasExpectedImageSignature,
  isSupportedImageMimeType,
} from '@campuspilot/s3/image';
import { env } from '@campuspilot/env/server';
import type { Database } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';

export const deleteDocumentObject = async (key: string) => {
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
};
export const readDocumentTemplate = async (key: string) => {
  const result = await getS3Client().send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (!result.Body) throw new Error('Template object has no content.');
  return result.Body.transformToString();
};
export function documentDownloadUrl(key: string, name: string) {
  const filename =
    name.replace(/[^a-zA-Z0-9 ._-]/g, '_').slice(0, 120) + '.pdf';
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
      ResponseContentType: 'application/pdf',
    }),
    { expiresIn: 300 },
  );
}
/** Objects have unique immutable keys. If the database cannot accept the row,
 * delete the upload; never overwrite a blob referenced by an older artifact.
 */
export async function persistDocumentObject<T>(
  db: Database,
  values: Omit<typeof artifactTable.$inferInsert, 'byteSize' | 'sha256'>,
  bytes: Buffer,
  commit: (
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    row: typeof artifactTable.$inferSelect,
  ) => Promise<T>,
) {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: values.s3Key,
      Body: bytes,
      ContentType: values.contentType,
    }),
  );
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(artifactTable)
        .values({
          ...values,
          byteSize: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
        .returning();
      return commit(tx, row!);
    });
  } catch (cause) {
    try {
      await deleteDocumentObject(values.s3Key);
    } catch (cleanupError) {
      throw new AggregateError(
        [cause, cleanupError],
        'Artifact persistence and upload cleanup failed.',
      );
    }
    throw cause;
  }
}
/** Only images fetched by an authorized context builder are embedded. Reading
 * S3 directly also works when the bucket endpoint is private to the server.
 */
export async function documentImage(key: string | null) {
  if (!key) return null;
  const image = await getS3Client().send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (
    !image.Body ||
    !image.ContentType ||
    !isSupportedImageMimeType(image.ContentType)
  )
    throw new Error('Document image has an unsupported format.');
  if (image.ContentLength && image.ContentLength > 5_000_000)
    throw new Error('Document image is too large.');
  const bytes = await image.Body.transformToByteArray();
  if (
    bytes.length > 5_000_000 ||
    !hasExpectedImageSignature(bytes, image.ContentType)
  )
    throw new Error('Document image is invalid.');
  return `data:${image.ContentType};base64,${Buffer.from(bytes).toString('base64')}`;
}
