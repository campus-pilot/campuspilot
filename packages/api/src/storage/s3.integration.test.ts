import { randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { afterEach, describe, expect, it } from 'vitest';

describe('S3-compatible local storage', () => {
  const s3 = getS3Client();
  const keys: string[] = [];
  const key = () => {
    const value = `storage-tests/${randomUUID()}/student photo + résumé.bin`;
    keys.push(value);
    return value;
  };
  afterEach(async () => {
    if (!keys.length) return;
    const deleted = await s3.send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: keys.splice(0).map((Key) => ({ Key })) } }));
    expect(deleted.Errors ?? []).toEqual([]);
  });

  it('preserves binary uploads, content metadata, listings, and deletion', async () => {
    const Key = key();
    const body = Buffer.from(Array.from({ length: 1024 * 1024 }, (_, index) => index % 256));
    await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key, Body: body, ContentType: 'application/octet-stream', Metadata: { purpose: 'storage-compatibility' } }));
    const head = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key }));
    expect(head.ContentLength).toBe(body.length);
    expect(head.ContentType).toBe('application/octet-stream');
    expect(head.Metadata).toEqual({ purpose: 'storage-compatibility' });
    const stored = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key }));
    expect(Buffer.from(await stored.Body!.transformToByteArray())).toEqual(body);
    const listing = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: Key }));
    expect(listing.Contents?.map((object) => object.Key)).toEqual([Key]);
    await s3.send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: [{ Key }] } }));
    await expect(s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
  });

  it('supports AWS SDK presigned upload and download URLs for encoded keys', async () => {
    const Key = key();
    const body = Buffer.from('A signed upload and download through the normal S3 client.');
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: env.S3_BUCKET, Key, ContentType: 'text/plain' }), { expiresIn: 60 });
    const uploaded = await fetch(uploadUrl, { method: 'PUT', body, headers: { 'content-type': 'text/plain' } });
    expect(uploaded.ok).toBe(true);
    const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key }), { expiresIn: 60 });
    const downloaded = await fetch(downloadUrl);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('text/plain');
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(body);
  });
});
