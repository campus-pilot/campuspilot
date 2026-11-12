import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';

import { log } from '../../../workflows/question-paper/log';

/**
 * Object keys of a paper's photos and figures. Everything lives under
 * `schools/{schoolId}/`, the prefix the demo purge sweeps. The keys are derived
 * from the page or figure id alone, never from the paper row, so a request can
 * write its objects before it opens the (short) database transaction that
 * locks the paper: storage I/O never runs while the school's session row is
 * locked. Objects written before this scheme keep their stored
 * `.../{paperId}/...` keys; every delete goes by the key stored on the row.
 */
export const questionPaperKeys = {
  original: (schoolId: string, pageId: string, extension: string) =>
    `schools/${schoolId}/exam-question-papers/pages/${pageId}/original.${extension}`,
  thumb: (schoolId: string, pageId: string) =>
    `schools/${schoolId}/exam-question-papers/pages/${pageId}/thumb.jpg`,
  model: (schoolId: string, pageId: string) =>
    `schools/${schoolId}/exam-question-papers/pages/${pageId}/model.jpg`,
  figure: (schoolId: string, figureId: string, extension: string) =>
    `schools/${schoolId}/exam-question-papers/figures/${figureId}.${extension}`,
} as const;

const DOWNLOAD_TTL_SECONDS = 5 * 60;
/** Page images are shown as `<img src>`; the redirect may be cached a little shorter than the URL lives. */
const IMAGE_CACHE_SECONDS = 240;

export async function putObject(key: string, bytes: Uint8Array, contentType: string) {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: contentType,
    }),
  );
}

export async function getObjectBytes(key: string): Promise<Buffer> {
  const result = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!result.Body) throw new Error('The stored object has no content.');
  return Buffer.from(await result.Body.transformToByteArray());
}

/**
 * Deletes objects after the database no longer references them. Storage is
 * not part of the database transaction, so this is best effort: a failure is
 * logged and the object is left for the demo purge or a storage sweep, never
 * allowed to fail a request that already committed.
 */
export async function deleteObjectsBestEffort(keys: ReadonlyArray<string | null | undefined>) {
  for (const key of new Set(keys.filter((value): value is string => Boolean(value)))) {
    try {
      await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    } catch (error) {
      log.warn({ err: error instanceof Error ? { name: error.name, message: error.message } : String(error), key }, 'question-paper.storage.delete.failed');
    }
  }
}

/**
 * Deletes objects and reports failure: every key is tried, and an error naming
 * the ones that could not be deleted is thrown at the end. For callers that
 * keep the database row as the handle to retry with (delete the objects first,
 * the row only once they are gone), unlike {@link deleteObjectsBestEffort}.
 */
export async function deleteObjects(keys: ReadonlyArray<string | null | undefined>) {
  const failed: string[] = [];
  for (const key of new Set(keys.filter((value): value is string => Boolean(value)))) {
    try {
      await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    } catch (error) {
      log.warn({ err: error instanceof Error ? { name: error.name, message: error.message } : String(error), key }, 'question-paper.storage.delete.failed');
      failed.push(key);
    }
  }
  if (failed.length > 0) throw new Error(`Could not delete ${failed.length} stored object(s): ${failed.join(', ')}`);
}

/** A short-lived URL for a page image; `inline` for `<img>`, `attachment` for "download the original". */
export function pageImageUrl(key: string, options: { contentType: string; fileName: string; disposition: 'inline' | 'attachment' }) {
  const safeName = options.fileName.replace(/[^a-zA-Z0-9 ._-]/g, '_').slice(0, 120) || 'page';
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `${options.disposition}; filename="${safeName}"`,
      ResponseContentType: options.contentType,
      ResponseCacheControl: `private, max-age=${IMAGE_CACHE_SECONDS}`,
    }),
    { expiresIn: DOWNLOAD_TTL_SECONDS },
  );
}
export const QUESTION_PAPER_IMAGE_CACHE_SECONDS = IMAGE_CACHE_SECONDS;
