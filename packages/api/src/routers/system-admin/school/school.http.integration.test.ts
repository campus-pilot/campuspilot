import { GetObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestSchool,
  type UserSession,
} from '../../../../test/fixtures';
import { handleSchoolLogoUpload } from './school.http';

describe('school.http Logo Handlers Integration with MinIO & PostgreSQL', () => {
  let adminSession: UserSession;
  let regularSession: UserSession;

  // Minimal valid 1x1 PNG image bytes
  const VALID_PNG_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic header
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  beforeAll(async () => {
    adminSession = await createAdminSession();
    regularSession = await createRegularUserSession();
  });

  describe('handleSchoolLogoUpload', () => {
    it('uploads valid PNG logo to MinIO and updates schoolTable', async () => {
      const school = await createTestSchool();

      const formData = new FormData();
      formData.set(
        'logo',
        new Blob([VALID_PNG_BYTES], { type: 'image/png' }),
        'school-logo.png',
      );

      const request = new Request('http://localhost/logo', {
        method: 'POST',
        body: formData,
      });

      const response = await handleSchoolLogoUpload(
        request,
        { db, headers: new Headers(), session: adminSession },
        school.id,
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        id: string;
        logoS3Key: string | null;
      };
      expect(json.id).toBe(school.id);
      expect(json.logoS3Key).toMatch(
        new RegExp(
          `^schools/${school.id}/logo/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`,
        ),
      );

      const storedLogo = await getS3Client().send(
        new GetObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: json.logoS3Key!,
        }),
      );
      expect(storedLogo.ContentType).toBe('image/png');
      expect(
        Buffer.from(await storedLogo.Body!.transformToByteArray()),
      ).toEqual(VALID_PNG_BYTES);
    });

    it('preserves a validated client filename extension', async () => {
      const school = await createTestSchool();
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
      const formData = new FormData();
      formData.set(
        'logo',
        new Blob([jpegBytes], { type: 'image/jpeg' }),
        'school-logo.jpeg',
      );

      const response = await handleSchoolLogoUpload(
        new Request('http://localhost/logo', {
          method: 'POST',
          body: formData,
        }),
        { db, headers: new Headers(), session: adminSession },
        school.id,
      );
      const json = (await response.json()) as { logoS3Key: string };

      expect(response.status).toBe(200);
      expect(json.logoS3Key).toMatch(
        new RegExp(`^schools/${school.id}/logo/.+\\.jpeg$`),
      );
    });

    it('rejects a filename extension that disagrees with the MIME type', async () => {
      const school = await createTestSchool();
      const formData = new FormData();
      formData.set(
        'logo',
        new Blob([VALID_PNG_BYTES], { type: 'image/png' }),
        'school-logo.jpg',
      );

      const response = await handleSchoolLogoUpload(
        new Request('http://localhost/logo', {
          method: 'POST',
          body: formData,
        }),
        { db, headers: new Headers(), session: adminSession },
        school.id,
      );

      expect(response.status).toBe(415);
    });

    it('rejects unsupported media type when uploaded file is text', async () => {
      const school = await createTestSchool();

      const formData = new FormData();
      formData.set(
        'logo',
        new Blob(['plain text not an image'], { type: 'text/plain' }),
        'notes.txt',
      );

      const request = new Request('http://localhost/logo', {
        method: 'POST',
        body: formData,
      });

      const response = await handleSchoolLogoUpload(
        request,
        { db, headers: new Headers(), session: adminSession },
        school.id,
      );

      expect(response.status).toBe(415);
    });

    it('rejects spoofed image format when mime type does not match image signature', async () => {
      const school = await createTestSchool();

      const formData = new FormData();
      formData.set(
        'logo',
        new Blob(['fake bytes not real png'], { type: 'image/png' }),
        'fake.png',
      );

      const request = new Request('http://localhost/logo', {
        method: 'POST',
        body: formData,
      });

      const response = await handleSchoolLogoUpload(
        request,
        { db, headers: new Headers(), session: adminSession },
        school.id,
      );

      expect(response.status).toBe(415);
    });

    it('denies regular users from uploading logo with FORBIDDEN (403)', async () => {
      const school = await createTestSchool();

      const formData = new FormData();
      formData.set(
        'logo',
        new Blob([VALID_PNG_BYTES], { type: 'image/png' }),
        'school-logo.png',
      );

      const request = new Request('http://localhost/logo', {
        method: 'POST',
        body: formData,
      });

      const response = await handleSchoolLogoUpload(
        request,
        { db, headers: new Headers(), session: regularSession },
        school.id,
      );

      expect(response.status).toBe(403);
    });

    it.each(['principal', 'manager'] as const)(
      'allows a school %s to upload the logo for their school',
      async (role) => {
        const school = await createTestSchool();
        const { session } = await createSchoolStaffSession(school.id, [
          { role },
        ]);
        const formData = new FormData();
        formData.set(
          'logo',
          new Blob([VALID_PNG_BYTES], { type: 'image/png' }),
          'school-logo.png',
        );

        const response = await handleSchoolLogoUpload(
          new Request('http://localhost/logo', {
            method: 'POST',
            body: formData,
          }),
          { db, headers: new Headers(), session },
          school.id,
        );

        expect(response.status).toBe(200);
      },
    );

    it('denies school staff when the requested school is outside their scope', async () => {
      const school = await createTestSchool();
      const otherSchool = await createTestSchool();
      const { session } = await createSchoolStaffSession(otherSchool.id, [
        { role: 'principal' },
      ]);
      const formData = new FormData();
      formData.set(
        'logo',
        new Blob([VALID_PNG_BYTES], { type: 'image/png' }),
        'school-logo.png',
      );

      const response = await handleSchoolLogoUpload(
        new Request('http://localhost/logo', {
          method: 'POST',
          body: formData,
        }),
        { db, headers: new Headers(), session },
        school.id,
      );

      expect(response.status).toBe(403);
    });
  });
});
