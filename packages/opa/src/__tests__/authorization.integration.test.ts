import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isAuthorized, type AuthorizationInput } from '../authorization';
import { OpaClient } from '../client';
import { CLASS_ACTIONS } from '../generated/class';
import { SCHOOL_ACTIONS } from '../generated/school';
import { SYSTEM_ACTIONS } from '../generated/system';
import { startOpaContainer, type RunningOpaContainer } from './opa-container';

describe('isAuthorized Integration with OPA Container', () => {
  let runningOpa: RunningOpaContainer;
  let client: OpaClient;

  beforeAll(async () => {
    runningOpa = await startOpaContainer();
    client = new OpaClient(runningOpa.url);
  }, 45000);

  afterAll(async () => {
    if (runningOpa) {
      await runningOpa.stop();
    }
  });

  describe('System Actions', () => {
    it('allows platform.admin to perform system actions', async () => {
      const allowed = await isAuthorized(
        {
          action: SYSTEM_ACTIONS.CREATE_SCHOOL,
          subject: {
            userId: 'admin-1',
            roleAssignments: [
              { role: 'platform.admin', scope: { kind: 'platform' } },
            ],
          },
          resource: { kind: 'system' },
        },
        { client },
      );

      expect(allowed).toBe(true);
    });

    it('denies school roles from performing system actions', async () => {
      const allowed = await isAuthorized(
        {
          action: SYSTEM_ACTIONS.CREATE_SCHOOL,
          subject: {
            userId: 'principal-1',
            roleAssignments: [
              {
                role: 'school.principal',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: null,
              },
            ],
          },
          resource: { kind: 'system' },
        },
        { client },
      );

      expect(allowed).toBe(false);
    });

    it('grants school feature flag actions to platform.admin only', async () => {
      const decide = (
        action:
          | typeof SYSTEM_ACTIONS.READ_SCHOOL_FEATURE_FLAGS
          | typeof SYSTEM_ACTIONS.UPDATE_SCHOOL_FEATURE_FLAGS,
        roleAssignments: Parameters<typeof isAuthorized>[0]['subject']['roleAssignments'],
      ) =>
        isAuthorized(
          { action, subject: { userId: 'user-1', roleAssignments }, resource: { kind: 'system' } },
          { client },
        );

      for (const action of [
        SYSTEM_ACTIONS.READ_SCHOOL_FEATURE_FLAGS,
        SYSTEM_ACTIONS.UPDATE_SCHOOL_FEATURE_FLAGS,
      ] as const) {
        expect(
          await decide(action, [{ role: 'platform.admin', scope: { kind: 'platform' } }]),
        ).toBe(true);
        expect(
          await decide(action, [{ role: 'platform.user', scope: { kind: 'platform' } }]),
        ).toBe(false);
        expect(
          await decide(action, [
            { role: 'school.principal', scope: { kind: 'school', schoolId: 'school-1' }, meta: null },
          ]),
        ).toBe(false);
      }
    });

  });

  describe('School Actions', () => {
    it('grants Cadet Portal password issuing to principals and managers only', async () => {
      const decide = (role: string) =>
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.ISSUE_ADMISSION_CADET_PASSWORD,
            subject: {
              userId: 'user-1',
              roleAssignments: [
                {
                  role,
                  scope: { kind: 'school', schoolId: 'school-1' },
                  meta: null,
                },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          } as AuthorizationInput,
          { client },
        );

      const [principal, manager, teacher, accountant] = await Promise.all([
        decide('school.principal'),
        decide('school.manager'),
        decide('school.teacher'),
        decide('school.accountant'),
      ]);
      expect({ principal, manager, teacher, accountant }).toEqual({
        principal: true,
        manager: true,
        teacher: false,
        accountant: false,
      });
    });

    it('allows school principals and platform admins to manage a school logo', async () => {
      const [principalReadAllowed, principalUpdateAllowed, adminAllowed] =
        await Promise.all([
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.READ_LOGO,
            subject: {
              userId: 'principal-1',
              roleAssignments: [
                {
                  role: 'school.principal',
                  scope: { kind: 'school', schoolId: 'school-1' },
                  meta: null,
                },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          },
          { client },
        ),
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.UPDATE_LOGO,
            subject: {
              userId: 'principal-1',
              roleAssignments: [
                {
                  role: 'school.principal',
                  scope: { kind: 'school', schoolId: 'school-1' },
                  meta: null,
                },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          },
          { client },
        ),
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.READ_LOGO,
            subject: {
              userId: 'admin-1',
              roleAssignments: [
                { role: 'platform.admin', scope: { kind: 'platform' } },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          },
          { client },
        ),
        ]);

      expect(principalReadAllowed).toBe(true);
      expect(principalUpdateAllowed).toBe(true);
      expect(adminAllowed).toBe(true);
    });

    it('allows school principal to invite member in their school', async () => {
      const allowed = await isAuthorized(
        {
          action: SCHOOL_ACTIONS.INVITE_MEMBER,
          subject: {
            userId: 'principal-1',
            roleAssignments: [
              {
                role: 'school.principal',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: null,
              },
            ],
          },
          resource: { kind: 'school', schoolId: 'school-1' },
        },
        { client },
      );

      expect(allowed).toBe(true);
    });

    it('denies school principal from accessing a different school (tenant isolation)', async () => {
      const allowed = await isAuthorized(
        {
          action: SCHOOL_ACTIONS.INVITE_MEMBER,
          subject: {
            userId: 'principal-1',
            roleAssignments: [
              {
                role: 'school.principal',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: null,
              },
            ],
          },
          resource: { kind: 'school', schoolId: 'school-2' },
        },
        { client },
      );

      expect(allowed).toBe(false);
    });

    it('denies ungranted school role (e.g. teacher) from inviting members', async () => {
      const allowed = await isAuthorized(
        {
          action: SCHOOL_ACTIONS.INVITE_MEMBER,
          subject: {
            userId: 'teacher-1',
            roleAssignments: [
              {
                role: 'school.teacher',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: { classIds: ['class-1'] },
              },
            ],
          },
          resource: { kind: 'school', schoolId: 'school-1' },
        },
        { client },
      );

      expect(allowed).toBe(false);
    });

    it('allows platform.admin to perform school member operations', async () => {
      const allowed = await isAuthorized(
        {
          action: SCHOOL_ACTIONS.LIST_MEMBERS,
          subject: {
            userId: 'admin-1',
            roleAssignments: [
              { role: 'platform.admin', scope: { kind: 'platform' } },
            ],
          },
          resource: { kind: 'school', schoolId: 'school-1' },
        },
        { client },
      );

      expect(allowed).toBe(true);
    });

    it('allows school manager to perform session operations', async () => {
      const allowed = await isAuthorized(
        {
          action: SCHOOL_ACTIONS.CREATE_SESSION,
          subject: {
            userId: 'manager-1',
            roleAssignments: [
              {
                role: 'school.manager',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: null,
              },
            ],
          },
          resource: { kind: 'school', schoolId: 'school-1' },
        },
        { client },
      );

      expect(allowed).toBe(true);
    });

    it('allows school principal to activate a session', async () => {
      const allowed = await isAuthorized(
        {
          action: SCHOOL_ACTIONS.ACTIVATE_SESSION,
          subject: {
            userId: 'principal-1',
            roleAssignments: [
              {
                role: 'school.principal',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: null,
              },
            ],
          },
          resource: { kind: 'school', schoolId: 'school-1' },
        },
        { client },
      );

      expect(allowed).toBe(true);
    });

    it('allows platform.admin to activate a school session', async () => {
      const allowed = await isAuthorized(
        {
          action: SCHOOL_ACTIONS.ACTIVATE_SESSION,
          subject: {
            userId: 'admin-1',
            roleAssignments: [
              { role: 'platform.admin', scope: { kind: 'platform' } },
            ],
          },
          resource: { kind: 'school', schoolId: 'school-1' },
        },
        { client },
      );

      expect(allowed).toBe(true);
    });

    it('allows principals to manage class order and teachers to edit class details', async () => {
      const [principalCanReorder, teacherCanUpdate, teacherCanUpdateConfig] = await Promise.all([
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.REORDER_CLASSES,
            subject: {
              userId: 'principal-1',
              roleAssignments: [
                {
                  role: 'school.principal',
                  scope: { kind: 'school', schoolId: 'school-1' },
                  meta: null,
                },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          },
          { client },
        ),
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.UPDATE_CLASS,
            subject: {
              userId: 'teacher-1',
              roleAssignments: [
                {
                  role: 'school.teacher',
                  scope: { kind: 'school', schoolId: 'school-1' },
                  meta: { classIds: [] },
                },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          },
          { client },
        ),
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.UPDATE_CLASS_CONFIGURATION,
            subject: {
              userId: 'teacher-1',
              roleAssignments: [
                {
                  role: 'school.teacher',
                  scope: { kind: 'school', schoolId: 'school-1' },
                  meta: { classIds: [] },
                },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          },
          { client },
        ),
      ]);

      expect(principalCanReorder).toBe(true);
      expect(teacherCanUpdate).toBe(true);
      expect(teacherCanUpdateConfig).toBe(true);
    });

    it('denies teachers and platform admins from creating classes', async () => {
      const [teacherAllowed, adminAllowed] = await Promise.all([
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.CREATE_CLASS,
            subject: {
              userId: 'teacher-1',
              roleAssignments: [
                {
                  role: 'school.teacher',
                  scope: { kind: 'school', schoolId: 'school-1' },
                  meta: { classIds: ['class-1'] },
                },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          },
          { client },
        ),
        isAuthorized(
          {
            action: SCHOOL_ACTIONS.CREATE_CLASS,
            subject: {
              userId: 'admin-1',
              roleAssignments: [
                { role: 'platform.admin', scope: { kind: 'platform' } },
              ],
            },
            resource: { kind: 'school', schoolId: 'school-1' },
          },
          { client },
        ),
      ]);

      expect(teacherAllowed).toBe(false);
      expect(adminAllowed).toBe(false);
    });
  });

  describe('Class Actions', () => {
    it('allows teacher with matching classId in meta to add student', async () => {
      const allowed = await isAuthorized(
        {
          action: CLASS_ACTIONS.ADD_STUDENT,
          subject: {
            userId: 'teacher-1',
            roleAssignments: [
              {
                role: 'school.teacher',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: { classIds: ['class-1', 'class-2'] },
              },
            ],
          },
          resource: { kind: 'class', schoolId: 'school-1', classId: 'class-1' },
        },
        { client },
      );

      expect(allowed).toBe(true);
    });

    it('denies teacher when target classId is not in metadata', async () => {
      const allowed = await isAuthorized(
        {
          action: CLASS_ACTIONS.ADD_STUDENT,
          subject: {
            userId: 'teacher-1',
            roleAssignments: [
              {
                role: 'school.teacher',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: { classIds: ['class-2'] },
              },
            ],
          },
          resource: { kind: 'class', schoolId: 'school-1', classId: 'class-1' },
        },
        { client },
      );

      expect(allowed).toBe(false);
    });

    it('denies teacher with null or missing class metadata', async () => {
      const allowed = await isAuthorized(
        {
          action: CLASS_ACTIONS.ADD_STUDENT,
          subject: {
            userId: 'teacher-1',
            roleAssignments: [
              {
                role: 'school.teacher',
                scope: { kind: 'school', schoolId: 'school-1' },
                meta: null,
              },
            ],
          },
          resource: { kind: 'class', schoolId: 'school-1', classId: 'class-1' },
        },
        { client },
      );

      expect(allowed).toBe(false);
    });
  });

  describe('Fail Closed', () => {
    it('fails closed for unknown actions', async () => {
      const allowed = await isAuthorized(
        {
          action: 'unknown.action' as unknown as typeof SYSTEM_ACTIONS.LIST_SCHOOLS,
          subject: {
            userId: 'admin-1',
            roleAssignments: [
              { role: 'platform.admin', scope: { kind: 'platform' } },
            ],
          },
          resource: { kind: 'system' },
        } as AuthorizationInput,
        { client },
      );

      expect(allowed).toBe(false);
    });
  });
});
