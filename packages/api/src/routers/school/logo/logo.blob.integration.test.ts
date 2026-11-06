import { PutObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createTestSchool } from '../../../../test/fixtures';
import { handleSchoolLogoBlob } from './logo.blob';

/** Stores a non-square logo so the square, padded rendering is observable. */
async function createSchoolWithLogo() {
  const logoS3Key = `schools/logo-blob-test/logo/${randomUUID()}.png`;
  const bytes = await sharp({
    create: { width: 300, height: 100, channels: 4, background: '#c2580e' },
  })
    .png()
    .toBuffer();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: logoS3Key,
      Body: bytes,
      ContentType: 'image/png',
    }),
  );
  return createTestSchool({ logoS3Key });
}

const request = (headers?: Record<string, string>) =>
  new Request('http://localhost/blob/school/logo', { headers });

describe('handleSchoolLogoBlob', () => {
  it.each(['192', '512'])(
    'serves a %spx square PNG without any session',
    async (size) => {
      const school = await createSchoolWithLogo();

      const response = await handleSchoolLogoBlob(
        { db },
        { schoolId: school.id, size },
        request(),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
      const metadata = await sharp(
        Buffer.from(await response.arrayBuffer()),
      ).metadata();
      expect(metadata).toMatchObject({
        format: 'png',
        width: Number(size),
        height: Number(size),
        hasAlpha: true,
      });
    },
  );

  it('answers a matching ETag with 304 and no body', async () => {
    const school = await createSchoolWithLogo();
    const first = await handleSchoolLogoBlob(
      { db },
      { schoolId: school.id, size: '192' },
      request(),
    );
    const entityTag = first.headers.get('etag');
    expect(entityTag).toBeTruthy();

    const revalidated = await handleSchoolLogoBlob(
      { db },
      { schoolId: school.id, size: '192' },
      request({ 'If-None-Match': entityTag! }),
    );

    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe('');
  });

  it('gives each size its own ETag', async () => {
    const school = await createSchoolWithLogo();
    const [small, large] = await Promise.all(
      ['192', '512'].map((size) =>
        handleSchoolLogoBlob({ db }, { schoolId: school.id, size }, request()),
      ),
    );

    expect(small!.headers.get('etag')).not.toBe(large!.headers.get('etag'));
  });

  it.each([undefined, '', '64', '1024', '192.0', '192px'])(
    'rejects size %j with BAD_REQUEST before reading the school',
    async (size) => {
      const response = await handleSchoolLogoBlob(
        { db },
        { schoolId: 'sch_does_not_exist', size },
        request(),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'BAD_REQUEST' });
    },
  );

  it('returns NOT_FOUND for an unknown school', async () => {
    const response = await handleSchoolLogoBlob(
      { db },
      { schoolId: 'sch_does_not_exist', size: '192' },
      request(),
    );

    expect(response.status).toBe(404);
  });

  it('returns NOT_FOUND for a school without a logo', async () => {
    const school = await createTestSchool();

    const response = await handleSchoolLogoBlob(
      { db },
      { schoolId: school.id, size: '192' },
      request(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});
