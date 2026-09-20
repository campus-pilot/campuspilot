import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  type UserSession,
} from '../../../test/fixtures';

describe('authorization.checkPermissions integration', () => {
  let schoolId: string;
  let otherSchoolId: string;
  let principalSession: UserSession;
  let teacherSession: UserSession;

  beforeAll(async () => {
    schoolId = (await createTestSchool()).id;
    otherSchoolId = (await createTestSchool()).id;
    principalSession = (
      await createSchoolStaffSession(schoolId, [{ role: 'principal' }])
    ).session;
    teacherSession = (
      await createSchoolStaffSession(schoolId, [
        { role: 'teacher', meta: { classIds: ['class-1'] } },
      ])
    ).session;
  });

  it('rejects anonymous callers', async () => {
    await expect(
      createTestClient(null).authorization.checkPermissions({
        permissions: [
          {
            action: SCHOOL_ACTIONS.INVITE_MEMBER,
            resource: { kind: 'school', schoolId },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns ordered allow and deny decisions for a bulk request', async () => {
    await expect(
      createTestClient(principalSession).authorization.checkPermissions({
        permissions: [
          {
            action: SCHOOL_ACTIONS.INVITE_MEMBER,
            resource: { kind: 'school', schoolId },
          },
          {
            action: SCHOOL_ACTIONS.INVITE_MEMBER,
            resource: { kind: 'school', schoolId: otherSchoolId },
          },
          {
            action: SYSTEM_ACTIONS.CREATE_SCHOOL,
            resource: { kind: 'system' },
          },
        ],
      }),
    ).resolves.toEqual({ results: [true, false, false] });
  });

  it('returns denied decisions instead of throwing FORBIDDEN', async () => {
    await expect(
      createTestClient(teacherSession).authorization.checkPermissions({
        permissions: [
          {
            action: SCHOOL_ACTIONS.INVITE_MEMBER,
            resource: { kind: 'school', schoolId },
          },
        ],
      }),
    ).resolves.toEqual({ results: [false] });
  });

  it('allows platform administrators according to the existing grants', async () => {
    const adminSession = await createAdminSession();

    await expect(
      createTestClient(adminSession).authorization.checkPermissions({
        permissions: [
          {
            action: SYSTEM_ACTIONS.CREATE_SCHOOL,
            resource: { kind: 'system' },
          },
          {
            action: SCHOOL_ACTIONS.INVITE_MEMBER,
            resource: { kind: 'school', schoolId },
          },
        ],
      }),
    ).resolves.toEqual({ results: [true, true] });
  });

  it('rejects requests containing more than one hundred permissions', async () => {
    await expect(
      createTestClient(principalSession).authorization.checkPermissions({
        permissions: Array.from({ length: 101 }, () => ({
          action: SCHOOL_ACTIONS.INVITE_MEMBER,
          resource: { kind: 'school' as const, schoolId },
        })),
      }),
    ).rejects.toBeDefined();
  });
});
