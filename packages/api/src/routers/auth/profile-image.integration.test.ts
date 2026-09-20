import { GetObjectCommand } from '@aws-sdk/client-s3';
import { importGoogleProfileImage } from '@campuspilot/auth/profile-image';
import { db } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  createRegularUserSession,
} from '../../../test/fixtures';
import {
  handleProfileImageRead,
  handleProfileImageUpload,
} from './auth.http';

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function profileImageRequest(
  bytes: Buffer | string = VALID_PNG_BYTES,
  type = 'image/png',
  filename = 'profile.png',
) {
  const formData = new FormData();
  const body = typeof bytes === 'string' ? bytes : Uint8Array.from(bytes);
  formData.set('profileImage', new Blob([body], { type }), filename);
  return new Request('http://localhost/api/blob/users/me/profile-image', {
    method: 'POST',
    body: formData,
  });
}

describe('profile image integration', () => {
  it('uploads to an immutable user key', async () => {
    const session = await createRegularUserSession();
    const response = await handleProfileImageUpload(
      profileImageRequest(),
      { db, headers: new Headers(), session },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const result = (await response.json()) as {
      profileImageS3Key: string;
    };
    expect(result.profileImageS3Key).toMatch(
      new RegExp(
        `^users/${session.user.id}/profile-image/[0-9a-f-]+\\.png$`,
      ),
    );

    const [storedUser] = await db
      .select({ profileImageS3Key: user.profileImageS3Key })
      .from(user)
      .where(eq(user.id, session.user.id));
    expect(storedUser?.profileImageS3Key).toBe(result.profileImageS3Key);

    const storedImage = await getS3Client().send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: result.profileImageS3Key,
      }),
    );
    expect(storedImage.ContentType).toBe('image/png');
    expect(Buffer.from(await storedImage.Body!.transformToByteArray())).toEqual(
      VALID_PNG_BYTES,
    );
  });

  it('redirects the authenticated image endpoint to the current private image', async () => {
    const session = await createRegularUserSession();
    await handleProfileImageUpload(profileImageRequest(), {
      db,
      headers: new Headers(),
      session,
    });

    const response = await handleProfileImageRead({
      db,
      headers: new Headers(),
      session,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('location')).toContain('X-Amz-Signature=');
  });

  it('returns NOT_FOUND when the user has not selected a profile image', async () => {
    const session = await createRegularUserSession();

    const response = await handleProfileImageRead({
      db,
      headers: new Headers(),
      session,
    });

    expect(response.status).toBe(404);
  });

  it('rejects anonymous uploads and reads', async () => {
    const upload = await handleProfileImageUpload(profileImageRequest(), {
      db,
      headers: new Headers(),
      session: null,
    });
    expect(upload.status).toBe(401);
    const read = await handleProfileImageRead({
      db,
      headers: new Headers(),
      session: null,
    });
    expect(read.status).toBe(401);
  });

  it('rejects unsupported or spoofed image uploads', async () => {
    const session = await createRegularUserSession();
    const context = { db, headers: new Headers(), session };

    const unsupported = await handleProfileImageUpload(
      profileImageRequest('plain text', 'text/plain', 'profile.txt'),
      context,
    );
    expect(unsupported.status).toBe(415);

    const spoofed = await handleProfileImageUpload(
      profileImageRequest('not a png', 'image/png', 'profile.png'),
      context,
    );
    expect(spoofed.status).toBe(415);
  });

  it('copies a bounded Google profile image into the user namespace', async () => {
    const session = await createRegularUserSession();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(VALID_PNG_BYTES, {
        headers: {
          'content-length': String(VALID_PNG_BYTES.byteLength),
          'content-type': 'image/png',
        },
      }),
    );

    const key = await importGoogleProfileImage(
      session.user.id,
      'https://lh3.googleusercontent.com/profile-photo',
    );
    fetchSpy.mockRestore();

    expect(key).toMatch(
      new RegExp(`^users/${session.user.id}/profile-image/.+\\.png$`),
    );
    const storedImage = await getS3Client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    expect(Buffer.from(await storedImage.Body!.transformToByteArray())).toEqual(
      VALID_PNG_BYTES,
    );
  });

  it('rejects non-Google source URLs before fetching them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      importGoogleProfileImage(
        crypto.randomUUID(),
        'https://example.com/profile.png',
      ),
    ).rejects.toThrow('untrusted host');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
