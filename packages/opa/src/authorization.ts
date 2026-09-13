import type {
  Role,
  RoleMeta,
} from '@campuspilot/db/schema/jsonb/role';
import { z } from 'zod';

import { classActions, type ClassAction } from './actions/class';
import { schoolActions, type SchoolAction } from './actions/school';
import { systemActions, type SystemAction } from './actions/system';
import { getOpaClient, type OpaClient } from './client';

export type RoleAssignment = {
  role: Role;
  meta: RoleMeta | null;
};

export type AuthorizationSubject = {
  userId: string;
  systemRole: string | null;
  roleAssignments: readonly RoleAssignment[];
};

export type SystemResource = {
  level: 'system';
};

export type SchoolResource = {
  level: 'school';
  schoolId: string;
};

export type ClassResource = {
  level: 'class';
  schoolId: string;
  classId: string;
};

/**
 * This map deliberately lists every action-to-resource relationship. Adding an
 * action without selecting its scope is therefore a compile-time error.
 */
export type AuthorizationResourceByAction = {
  [systemActions.listSchools]: SystemResource;
  [systemActions.readSchool]: SystemResource;
  [systemActions.createSchool]: SystemResource;
  [systemActions.updateSchool]: SystemResource;
  [systemActions.updateSchoolLogo]: SystemResource;
  [systemActions.deleteSchool]: SystemResource;
  [schoolActions.inviteMember]: SchoolResource;
  [classActions.addStudent]: ClassResource;
};

export type AuthorizationAction = keyof AuthorizationResourceByAction;

export type AuthorizationRequest =
  | { action: SystemAction; resource: SystemResource }
  | { action: SchoolAction; resource: SchoolResource }
  | { action: ClassAction; resource: ClassResource };

export type AuthorizationInput = AuthorizationRequest & {
  subject: AuthorizationSubject;
};

type KnownAction = SystemAction | SchoolAction | ClassAction;
type AllActionsHaveResources = Exclude<
  KnownAction,
  AuthorizationAction
> extends never
  ? true
  : never;

const allActionsHaveResources: AllActionsHaveResources = true;
void allActionsHaveResources;

const authorizationDecisionSchema = z.object({
  allowed: z.boolean(),
});

const AUTHORIZATION_POLICY_PATH = 'campuspilot/authorization/decision';

/**
 * Evaluates the canonical authorization decision and validates OPA's response.
 * Undefined and malformed decisions throw instead of accidentally granting access.
 */
export async function isAuthorized(
  input: AuthorizationInput,
  options?: { client?: OpaClient; signal?: AbortSignal },
): Promise<boolean> {
  const client = options?.client ?? getOpaClient();
  const decision = await client.queryValidated(
    AUTHORIZATION_POLICY_PATH,
    input,
    authorizationDecisionSchema,
    { signal: options?.signal },
  );

  return decision.allowed;
}
