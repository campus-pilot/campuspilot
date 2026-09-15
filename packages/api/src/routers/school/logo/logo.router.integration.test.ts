import { PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { ORPCError } from '@orpc/server';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  type UserSession,
} from '../../../../test/fixtures';

describe('school.getLogo integration', () => {
  let adminSession: UserSession;
  let regularSession: UserSession;

  beforeAll(async () => {
    adminSession = await createAdminSession();
    regularSession = await createRegularUserSession();
  });

  async function createSchoolWithLogo() {
    const schoolId = crypto.randomUUID();
    const school = await createTestSchool({
      id: schoolId,
      logoS3Key: `schools/${schoolId}/logo/${crypto.randomUUID()}.png`,
    });
    const bytes = Buffer.from('school-logo');
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: school.logoS3Key!,
        Body: bytes,
        ContentType: 'image/png',
      }),
    );
    return { school, bytes };
  }

  it('returns a presigned URL that downloads the private logo for a platform admin', async () => {
    const { school, bytes } = await createSchoolWithLogo();

    const result = await createTestClient(adminSession).school.getLogo({
      schoolId: school.id,
    });

    expect(result.url).toContain('X-Amz-Signature=');
    const response = await fetch(result.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each(['principal', 'manager'] as const)(
    'allows a school %s to request the logo URL for their school',
    async (role) => {
      const { school } = await createSchoolWithLogo();
      const { session } = await createSchoolStaffSession(school.id, [{ role }]);

      const result = await createTestClient(session).school.getLogo({
        schoolId: school.id,
      });

      expect(result.url).toContain('X-Amz-Signature=');
    },
  );

  it('rejects anonymous and ungranted callers', async () => {
    const { school } = await createSchoolWithLogo();

    await expect(
      createTestClient(null).school.getLogo({ schoolId: school.id }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      createTestClient(regularSession).school.getLogo({ schoolId: school.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a school role scoped to another tenant', async () => {
    const { school } = await createSchoolWithLogo();
    const otherSchool = await createTestSchool();
    const { session } = await createSchoolStaffSession(otherSchool.id, [
      { role: 'principal' },
    ]);

    await expect(
      createTestClient(session).school.getLogo({ schoolId: school.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns NOT_FOUND when the school has no logo', async () => {
    const school = await createTestSchool({ logoS3Key: null });

    await expect(
      createTestClient(adminSession).school.getLogo({ schoolId: school.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('validates the school id before authorization', async () => {
    await expect(
      createTestClient(adminSession).school.getLogo({ schoolId: '' }),
    ).rejects.toBeInstanceOf(ORPCError);
  });
});
