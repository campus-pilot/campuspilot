import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  isAuthorized,
  type AuthorizationInput,
  type RoleAssignment,
} from '../authorization';
import { OpaClient } from '../client';
import { SCHOOL_ACTIONS, type SchoolAction } from '../generated/school';
import { startOpaContainer, type RunningOpaContainer } from './opa-container';

const financeActions = () =>
  [
    SCHOOL_ACTIONS.READ_SESSION_FINANCE,
    SCHOOL_ACTIONS.UPDATE_SESSION_FINANCE,
    SCHOOL_ACTIONS.READ_ADMISSION_FINANCE,
    SCHOOL_ACTIONS.UPDATE_ADMISSION_FINANCE,
    SCHOOL_ACTIONS.READ_BILLING_RUNS,
    SCHOOL_ACTIONS.READ_BILLING_REPORTS,
    SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
  ] as const;

function schoolRequest(
  action: SchoolAction,
  role: RoleAssignment['role'],
  assignmentSchoolId = 'school-1',
): AuthorizationInput {
  return {
    action,
    subject: {
      userId: 'finance-user',
      roleAssignments: [
        {
          role,
          scope: { kind: 'school', schoolId: assignmentSchoolId },
          meta: role === 'school.teacher' ? { classIds: [] } : null,
        } as RoleAssignment,
      ],
    },
    resource: { kind: 'school', schoolId: 'school-1' },
  } as AuthorizationInput;
}

function platformRequest(action: SchoolAction): AuthorizationInput {
  return {
    action,
    subject: {
      userId: 'admin-1',
      roleAssignments: [
        { role: 'platform.admin', scope: { kind: 'platform' } },
      ],
    },
    resource: { kind: 'school', schoolId: 'school-1' },
  } as AuthorizationInput;
}

describe('Finance permissions against real OPA', () => {
  let running: RunningOpaContainer;
  let client: OpaClient;

  beforeAll(async () => {
    running = await startOpaContainer();
    client = new OpaClient(running.url);
  }, 45000);

  afterAll(async () => {
    await running?.stop();
  });

  it('grants finance roles and rejects non-finance roles and other tenants', async () => {
    for (const action of financeActions()) {
      for (const role of [
        'school.principal',
        'school.manager',
        'school.accountant',
      ] as const) {
        await expect(
          isAuthorized(schoolRequest(action, role), { client }),
        ).resolves.toBe(true);
        await expect(
          isAuthorized(schoolRequest(action, role, 'school-2'), { client }),
        ).resolves.toBe(false);
      }

      for (const role of [
        'school.teacher',
        'school.exam_coordinator',
      ] as const) {
        await expect(
          isAuthorized(schoolRequest(action, role), { client }),
        ).resolves.toBe(false);
      }
    }
  });

  it('grants platform administrators finance reads and pricing updates', async () => {
    for (const action of financeActions()) {
      await expect(
        isAuthorized(platformRequest(action), { client }),
      ).resolves.toBe(true);
    }
  });
});
