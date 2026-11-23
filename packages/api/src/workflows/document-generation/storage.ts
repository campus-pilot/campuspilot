import { createHash, randomBytes } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';

import { DocumentConversionRefused } from '../../routers/school/document/document.render';

/**
 * Object storage of a generation job. Everything a job writes before its PDF
 * is ready lives under its own private prefix, `schools/{schoolId}/document-jobs/{jobId}/`:
 * the batch contexts (`batch-0001.json`), the batch PDFs (`batch-0001.pdf`)
 * and the manifest. Keys are deterministic, so a retried step overwrites its
 * own object and never adds one. The prefix is inside the school's prefix,
 * so the demo purge's sweep of `schools/{schoolId}/` removes it with
 * everything else. The finished PDF is stored where generated PDFs always
 * were, `schools/{schoolId}/documents/{artifactId}.pdf`, under the artifact id
 * the job reserved.
 *
 * The temporary prefix is removed when the job ends (worker), or by the API
 * sweep for an ended job whose objects are still there.
 */

export function documentJobPrefix(schoolId: string, jobId: string) {
  return `schools/${schoolId}/document-jobs/${jobId}/`;
}

const pad = (index: number) => String(index + 1).padStart(4, '0');

/** Contexts of batch `index` (0-based); the name sorts in batch order. */
export function batchContextsKey(prefix: string, index: number) {
  return `${prefix}batch-${pad(index)}.json`;
}

/** PDF of batch `index` (0-based); Gotenberg merges form files in name order, and these names sort in batch order. */
export function batchPdfName(index: number) {
  return `batch-${pad(index)}.pdf`;
}

export function batchPdfKey(prefix: string, index: number) {
  return `${prefix}${batchPdfName(index)}`;
}

export function manifestKey(prefix: string) {
  return `${prefix}manifest.json`;
}

/** The finished PDF, at the key generated PDFs have always used. */
export function documentPdfKey(schoolId: string, artifactId: string) {
  return `schools/${schoolId}/documents/${artifactId}.pdf`;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function putObject(key: string, bytes: Uint8Array, contentType: string) {
  await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: bytes, ContentType: contentType }));
  return { byteSize: bytes.length, sha256: sha256(bytes) };
}

export async function putJson(key: string, value: unknown) {
  return putObject(key, Buffer.from(JSON.stringify(value)), 'application/json');
}

export async function getJson(key: string): Promise<unknown> {
  const result = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!result.Body) throw new Error('A document job object has no content.');
  return JSON.parse(await result.Body.transformToString());
}

/** The object's bytes as a stream, read as it is consumed (never buffered whole). */
async function objectStream(key: string): Promise<AsyncIterable<Uint8Array>> {
  const result = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!result.Body) throw new Error('A document job object has no content.');
  return result.Body as unknown as AsyncIterable<Uint8Array>;
}

export async function deleteObject(key: string) {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

/** Deletes every object under `prefix` (a job's own prefix only). Missing objects are fine. */
export async function deletePrefix(prefix: string) {
  if (!/^schools\/[^/]+\/document-jobs\/dgj_[a-z0-9]{21}\/$/.test(prefix)) throw new Error('Refusing to delete outside a document job prefix.');
  let continuationToken: string | undefined;
  do {
    const page = await getS3Client().send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, ContinuationToken: continuationToken }));
    const keys = (page.Contents ?? []).map((object) => object.Key).filter((key): key is string => Boolean(key));
    if (keys.length > 0) {
      const result = await getS3Client().send(
        new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
      );
      const failed = (result.Errors ?? []).filter((item) => item.Code !== 'NoSuchKey');
      if (failed.length > 0) throw new Error(`S3 refused to delete ${failed.length} document job objects.`);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

/** S3's smallest part (every part but the last). */
const PART_BYTES = 8 * 1024 * 1024;

/**
 * Stores a stream as one object without holding it in memory: parts of
 * 8 MiB are uploaded as they fill (S3 multipart upload), a stream smaller
 * than one part is a single put. Returns the size and SHA-256 of what was
 * stored. A failed upload is aborted, so no part is left behind. `maxBytes`
 * stops a stream that grows past it.
 */
export async function uploadStream(
  key: string,
  stream: AsyncIterable<Uint8Array>,
  options: { contentType: string; maxBytes: number; tooLarge?: () => Error },
): Promise<{ byteSize: number; sha256: string }> {
  const hash = createHash('sha256');
  let byteSize = 0;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let uploadId: string | undefined;
  const parts: Array<{ ETag: string; PartNumber: number }> = [];
  const client = getS3Client();
  const flushPart = async () => {
    const body = Buffer.concat(pending, pendingBytes);
    pending = [];
    pendingBytes = 0;
    uploadId ??= (await client.send(new CreateMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: options.contentType }))).UploadId;
    if (!uploadId) throw new Error('Object storage did not start a multipart upload.');
    const partNumber = parts.length + 1;
    const part = await client.send(
      new UploadPartCommand({ Bucket: env.S3_BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body, ContentLength: body.length }),
    );
    if (!part.ETag) throw new Error('Object storage did not confirm a part.');
    parts.push({ ETag: part.ETag, PartNumber: partNumber });
  };
  try {
    for await (const chunk of stream) {
      byteSize += chunk.length;
      if (byteSize > options.maxBytes) throw options.tooLarge?.() ?? new Error('The document is larger than the stored PDF limit.');
      hash.update(chunk);
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= PART_BYTES) await flushPart();
    }
    if (!uploadId) {
      const body = Buffer.concat(pending, pendingBytes);
      await client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: options.contentType }));
    } else {
      if (pendingBytes > 0) await flushPart();
      await client.send(
        new CompleteMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }),
      );
    }
    return { byteSize, sha256: hash.digest('hex') };
  } catch (error) {
    if (uploadId) {
      await client
        .send(new AbortMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: key, UploadId: uploadId }))
        .catch(() => undefined);
    }
    throw error;
  }
}

/** Largest merged PDF a job stores; far above 1,500 photo documents. */
export const MERGED_PDF_MAX_BYTES = 1_000_000_000;
/** How long Gotenberg may take to merge one job's batch PDFs. */
const MERGE_TIMEOUT_MS = 10 * 60_000;

/**
 * A multipart/form-data body of `files` parts, streamed object by object in
 * the given order (each object is read only when its part is sent).
 */
async function* mergeForm(boundary: string, files: ReadonlyArray<{ key: string; name: string }>): AsyncGenerator<Uint8Array> {
  for (const file of files) {
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: application/pdf\r\n\r\n`,
    );
    for await (const chunk of await objectStream(file.key)) yield chunk;
    yield Buffer.from('\r\n');
  }
  yield Buffer.from(`--${boundary}--\r\n`);
}

/** Checks the first bytes of a stream are a PDF's and passes every byte on. */
async function* pdfBytes(stream: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let head = Buffer.alloc(0);
  let checked = false;
  for await (const chunk of stream) {
    if (!checked) {
      head = Buffer.concat([head, chunk]);
      if (head.length < 5) continue;
      if (head.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF merge returned something that is not a PDF.');
      checked = true;
      yield head;
      continue;
    }
    yield chunk;
  }
  if (!checked) throw new Error('PDF merge returned something that is not a PDF.');
}

/**
 * Merges batch PDFs, in the given order, into one PDF at `outputKey` with
 * Gotenberg (`/forms/pdfengines/merge`, which merges its files in name order;
 * the names sort in batch order). Neither the inputs nor the result are held
 * in memory: the request body streams each batch from storage in turn and
 * the response streams into a multipart upload.
 */
export async function mergeBatchPdfs(
  files: ReadonlyArray<{ key: string; name: string }>,
  outputKey: string,
): Promise<{ byteSize: number; sha256: string }> {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (sorted.some((file, index) => file !== files[index])) throw new Error('Batch PDFs must be named in batch order.');
  const boundary = `campuspilot-${randomBytes(16).toString('hex')}`;
  const response = await fetch(`${env.GOTENBERG_URL.replace(/\/$/, '')}/forms/pdfengines/merge`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: mergeForm(boundary, files) as unknown as RequestInit['body'],
    // A streamed request body needs half duplex (Node's fetch).
    duplex: 'half',
    signal: AbortSignal.timeout(MERGE_TIMEOUT_MS),
  } as RequestInit & { duplex: 'half' });
  // As for a conversion: a refusal (4xx but 408/429) or an oversized result would fail the same way again.
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    await response.body?.cancel().catch(() => undefined);
    throw new DocumentConversionRefused('refused', `PDF merge was refused (${response.status}).`);
  }
  if (!response.ok || !response.body) throw new Error(`PDF merge failed (${response.status}).`);
  const tooLarge = () => new DocumentConversionRefused('too_large', 'The merged PDF is larger than the stored PDF limit.');
  const declared = Number(response.headers.get('content-length') ?? 'NaN');
  if (Number.isFinite(declared) && declared > MERGED_PDF_MAX_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw tooLarge();
  }
  return uploadStream(outputKey, pdfBytes(response.body as unknown as AsyncIterable<Uint8Array>), {
    contentType: 'application/pdf',
    maxBytes: MERGED_PDF_MAX_BYTES,
    tooLarge,
  });
}
