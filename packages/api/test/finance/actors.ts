import type { Role, RoleMeta } from '@campuspilot/db/schema/jsonb/role';

import type { AppRouterClient } from '../../src/routers';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  type UserSession,
} from '../fixtures';

export type FinanceActor = {
  session: UserSession;
  client: AppRouterClient;
};

export type FinanceActors = {
  principal: FinanceActor;
  manager: FinanceActor;
  accountant: FinanceActor;
  teacher: FinanceActor;
  examCoordinator: FinanceActor;
  outsiderManager: FinanceActor;
  platformAdmin: FinanceActor;
  regularUser: FinanceActor;
  anonymous: { session: null; client: AppRouterClient };
};

async function createSchoolActor(
  schoolId: string,
  role: Role,
  meta: RoleMeta | null = null,
): Promise<FinanceActor> {
  const actor = await createSchoolStaffSession(schoolId, [{ role, meta }]);
  return { session: actor.session, client: createTestClient(actor.session) };
}

/**
 * Creates the complete finance authorization matrix. The outsider is granted
 * finance access in another school so tests distinguish scope denial from a
 * role that has no finance grant at all.
 */
export async function createFinanceActors(
  schoolId: string,
  outsiderSchoolId: string,
): Promise<FinanceActors> {
  const [
    principal,
    manager,
    accountant,
    teacher,
    examCoordinator,
    outsiderManager,
    platformSession,
    regularSession,
  ] = await Promise.all([
    createSchoolActor(schoolId, 'principal'),
    createSchoolActor(schoolId, 'manager'),
    createSchoolActor(schoolId, 'accountant'),
    createSchoolActor(schoolId, 'teacher', { classIds: [] }),
    createSchoolActor(schoolId, 'exam_coordinator'),
    createSchoolActor(outsiderSchoolId, 'manager'),
    createAdminSession(),
    createRegularUserSession(),
  ]);

  return {
    principal,
    manager,
    accountant,
    teacher,
    examCoordinator,
    outsiderManager,
    platformAdmin: {
      session: platformSession,
      client: createTestClient(platformSession),
    },
    regularUser: {
      session: regularSession,
      client: createTestClient(regularSession),
    },
    anonymous: { session: null, client: createTestClient(null) },
  };
}
