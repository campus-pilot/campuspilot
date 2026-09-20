import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  type UserSession,
} from '../../../../test/fixtures';

describe('school.member Router Integration', () => {
  let school: Awaited<ReturnType<typeof createTestSchool>>;
  let principalSession: UserSession;
  let managerSession: UserSession;
  let teacherSession: UserSession;
  let regularSession: UserSession;

  beforeAll(async () => {
    school = await createTestSchool();

    const principalStaff = await createSchoolStaffSession(school.id, [
      { role: 'principal', meta: null },
    ]);
    principalSession = principalStaff.session;

    const managerStaff = await createSchoolStaffSession(school.id, [
      { role: 'manager', meta: null },
    ]);
    managerSession = managerStaff.session;

    const teacherStaff = await createSchoolStaffSession(school.id, [
      { role: 'teacher', meta: { classIds: ['c1'] } },
    ]);
    teacherSession = teacherStaff.session;

    regularSession = await createRegularUserSession();
  });

  describe('inviteMember', () => {
    it('allows school principal to invite a new member with roles', async () => {
      const client = createTestClient(principalSession);
      const email = `invited_${randomUUID().toLowerCase()}@example.com`;

      const member = await client.school.inviteMember({
        schoolId: school.id,
        email,
        roles: [
          { role: 'teacher', meta: { classIds: ['class-101'] } },
        ],
      });

      expect(member).toBeDefined();
      expect(member.schoolId).toBe(school.id);
      expect(member.email).toBe(email);
      expect(member.roles).toHaveLength(1);
      expect(member.roles[0]!.role).toBe('teacher');
      expect(member.roles[0]!.meta).toEqual({ classIds: ['class-101'] });

      // Verify user was provisioned in auth user table
      const [dbUser] = await db
        .select()
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      expect(dbUser).toBeDefined();
      expect(dbUser!.id).toBe(member.userId);
      expect(dbUser!.emailVerified).toBe(true);
    });

    it('allows school manager to invite a member', async () => {
      const client = createTestClient(managerSession);
      const email = `mgr_invite_${randomUUID().toLowerCase()}@example.com`;

      const member = await client.school.inviteMember({
        schoolId: school.id,
        email,
        roles: [{ role: 'accountant', meta: null }],
      });

      expect(member.email).toBe(email);
      expect(member.roles[0]!.role).toBe('accountant');
    });

    it('returns CONFLICT when inviting an already existing school member', async () => {
      const client = createTestClient(principalSession);
      const email = `duplicate_${randomUUID().toLowerCase()}@example.com`;

      await client.school.inviteMember({
        schoolId: school.id,
        email,
        roles: [{ role: 'exam_coordinator', meta: null }],
      });

      await expect(
        client.school.inviteMember({
          schoolId: school.id,
          email,
          roles: [{ role: 'exam_coordinator', meta: null }],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'CONFLICT' }),
      );
    });

    it('rejects classIds metadata attached to non-teacher role with validation error', async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.inviteMember({
          schoolId: school.id,
          email: `invalid_role_${randomUUID().toLowerCase()}@example.com`,
          roles: [
            { role: 'manager', meta: { classIds: ['c1'] } },
          ],
        }),
      ).rejects.toThrow();
    });

    it('denies school teacher from inviting members with FORBIDDEN', async () => {
      const teacherClient = createTestClient(teacherSession);

      await expect(
        teacherClient.school.inviteMember({
          schoolId: school.id,
          email: `teacher_invite_${randomUUID().toLowerCase()}@example.com`,
          roles: [{ role: 'exam_coordinator', meta: null }],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });

    it('denies user from another school with FORBIDDEN (tenant isolation)', async () => {
      const otherSchool = await createTestSchool();
      const client = createTestClient(principalSession); // Principal of 'school', not 'otherSchool'

      await expect(
        client.school.inviteMember({
          schoolId: otherSchool.id,
          email: `tenant_iso_${randomUUID().toLowerCase()}@example.com`,
          roles: [{ role: 'exam_coordinator', meta: null }],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });

  describe('getMember', () => {
    it('allows principal to retrieve a school member by user ID', async () => {
      const client = createTestClient(principalSession);
      const email = `get_member_${randomUUID().toLowerCase()}@example.com`;

      const invited = await client.school.inviteMember({
        schoolId: school.id,
        email,
        roles: [{ role: 'teacher', meta: { classIds: ['c1', 'c2'] } }],
      });

      const member = await client.school.getMember({
        schoolId: school.id,
        userId: invited.userId,
      });

      expect(member).toBeDefined();
      expect(member.userId).toBe(invited.userId);
      expect(member.email).toBe(email);
      expect(member.roles[0]!.role).toBe('teacher');
      expect(member.roles[0]!.meta).toEqual({ classIds: ['c1', 'c2'] });
    });

    it('returns NOT_FOUND when member does not exist in school', async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.getMember({
          schoolId: school.id,
          userId: 'non-existent-user-id',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });

    it('returns a private S3 profile-image URL instead of the provider URL', async () => {
      const client = createTestClient(principalSession);
      const invited = await client.school.inviteMember({
        schoolId: school.id,
        email: `profile_${randomUUID().toLowerCase()}@example.com`,
        roles: [{ role: 'teacher', meta: null }],
      });
      const profileImageS3Key =
        `users/${invited.userId}/profile-image/${randomUUID()}.png`;
      await Promise.all([
        db
          .update(user)
          .set({
            image: 'https://lh3.googleusercontent.com/provider-image',
            profileImageS3Key,
          })
          .where(eq(user.id, invited.userId)),
        getS3Client().send(
          new PutObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: profileImageS3Key,
            Body: Buffer.from('profile-image'),
            ContentType: 'image/png',
          }),
        ),
      ]);

      const member = await client.school.getMember({
        schoolId: school.id,
        userId: invited.userId,
      });

      expect(member.profileImageUrl).toContain('X-Amz-Signature=');
      expect(member).not.toHaveProperty('profileImageS3Key');
      expect(member).not.toHaveProperty('image');
    });
  });

  describe('listMembers', () => {
    it('allows principal to list members with pagination and search query', async () => {
      const client = createTestClient(principalSession);
      const tag = `listtag_${randomUUID().toLowerCase()}`;

      await client.school.inviteMember({
        schoolId: school.id,
        email: `alice_${tag}@example.com`,
        roles: [{ role: 'teacher', meta: { classIds: ['c1'] } }],
      });
      await client.school.inviteMember({
        schoolId: school.id,
        email: `bob_${tag}@example.com`,
        roles: [{ role: 'accountant', meta: null }],
      });

      const result = await client.school.listMembers({
        schoolId: school.id,
        searchQuery: tag,
        limit: 10,
        page: 1,
      });

      expect(result.items.length).toBe(2);
      expect(result.pagination.totalItems).toBe(2);
      expect(result.pagination.pageSize).toBe(10);
      expect(result.items.every((m) => m.email.includes(tag))).toBe(true);
    });

    it('denies regular users from listing members', async () => {
      const regularClient = createTestClient(regularSession);

      await expect(
        regularClient.school.listMembers({ schoolId: school.id }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });

    it('allows a teacher in the school to list members', async () => {
      const result = await createTestClient(teacherSession).school.listMembers({
        schoolId: school.id,
      });

      expect(result.items.some(({ userId }) => userId === teacherSession.user.id)).toBe(true);
    });
  });

  describe('updateMemberRoles', () => {
    it('atomically replaces a member role set', async () => {
      const client = createTestClient(principalSession);
      const email = `updateroles_${randomUUID().toLowerCase()}@example.com`;

      const invited = await client.school.inviteMember({
        schoolId: school.id,
        email,
        roles: [
          { role: 'teacher', meta: { classIds: ['c1'] } },
          { role: 'accountant', meta: null },
        ],
      });

      expect(invited.roles).toHaveLength(2);

      // Replace roles: only exam_coordinator now
      const updated = await client.school.updateMemberRoles({
        schoolId: school.id,
        userId: invited.userId,
        roles: [{ role: 'exam_coordinator', meta: null }],
      });

      expect(updated.roles).toHaveLength(1);
      expect(updated.roles[0]!.role).toBe('exam_coordinator');

      // Verify re-reading reflects the replacement
      const reread = await client.school.getMember({
        schoolId: school.id,
        userId: invited.userId,
      });
      expect(reread.roles).toHaveLength(1);
      expect(reread.roles[0]!.role).toBe('exam_coordinator');
    });

    it('returns NOT_FOUND when updating roles for non-existent member', async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.updateMemberRoles({
          schoolId: school.id,
          userId: 'non-existent-user-id',
          roles: [{ role: 'exam_coordinator', meta: null }],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });
  });

  describe('removeMember', () => {
    it('removes member and school roles while preserving the global user record', async () => {
      const client = createTestClient(principalSession);
      const email = `remove_${randomUUID().toLowerCase()}@example.com`;

      const invited = await client.school.inviteMember({
        schoolId: school.id,
        email,
        roles: [{ role: 'accountant', meta: null }],
      });

      const removed = await client.school.removeMember({
        schoolId: school.id,
        userId: invited.userId,
      });

      expect(removed.userId).toBe(invited.userId);

      // Verify member is no longer in school
      await expect(
        client.school.getMember({
          schoolId: school.id,
          userId: invited.userId,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );

      // Verify global user record still exists in database
      const [globalUser] = await db
        .select()
        .from(user)
        .where(eq(user.id, invited.userId))
        .limit(1);
      expect(globalUser).toBeDefined();
      expect(globalUser!.email).toBe(email);
    });

    it('returns NOT_FOUND when removing non-existent member', async () => {
      const client = createTestClient(principalSession);

      await expect(
        client.school.removeMember({
          schoolId: school.id,
          userId: 'non-existent-user-id',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });
  });
});
