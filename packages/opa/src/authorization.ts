import type {
  Role,
  RoleMeta,
} from '@campuspilot/db/schema/jsonb/role';
import { z } from 'zod';

import { getOpaClient, type OpaClient } from './client';
import type {
  AuthorizationAction,
  AuthorizationResourceByAction,
} from './generated/resource';

export type {
  AuthorizationAction,
  AuthorizationResourceByAction,
  ClassResource,
  SchoolResource,
  SystemResource,
} from './generated/resource';

export type PlatformRoleAssignment = {
  role: `platform.${string}`;
  scope: { kind: 'platform' };
};

export type SchoolRoleAssignment = {
  role: `school.${Role}`;
  scope: { kind: 'school'; schoolId: string };
  meta: RoleMeta | null;
};

/**
 * A runtime role fact. The role namespace identifies the role vocabulary while
 * scope records where this particular assignment is valid.
 */
export type RoleAssignment =
  | PlatformRoleAssignment
  | SchoolRoleAssignment;

export type AuthorizationSubject = {
  userId: string;
  roleAssignments: readonly RoleAssignment[];
};

/** The generated map preserves the exact action/resource-kind correlation. */
export type AuthorizationRequest = {
  [TAction in AuthorizationAction]: {
    action: TAction;
    resource: AuthorizationResourceByAction[TAction];
  };
}[AuthorizationAction];

export type AuthorizationInput = AuthorizationRequest & {
  subject: AuthorizationSubject;
};

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
