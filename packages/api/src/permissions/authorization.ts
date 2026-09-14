import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import {
  isAuthorized,
  type AuthorizationInput,
  type AuthorizationRequest,
  type RoleAssignment,
} from '@campuspilot/opa/authorization';
import { and, eq } from 'drizzle-orm';

import type { Context } from '../context';
import { rpcError } from '../errors';

/**
 * Resolves all role assignments for the subject and resource before asking OPA.
 * Multiple school roles are preserved as separate facts, including each row's
 * metadata. Every assignment carries its explicit runtime scope; namespaced
 * roles identify the role vocabulary independently of that scope.
 */
export async function assertPermission(
  context: Context,
  request: AuthorizationRequest,
  signal?: AbortSignal,
): Promise<void> {
  const authenticatedUser = context.session?.user;
  if (!authenticatedUser) throw rpcError.unauthorized();

  const roleAssignments: RoleAssignment[] = [
    ...(authenticatedUser.role
      ? [
          {
            role: `platform.${authenticatedUser.role}` as const,
            scope: { kind: 'platform' as const },
          },
        ]
      : []),
  ];

  if (request.resource.kind !== 'system') {
    const schoolId = request.resource.schoolId;
    const schoolRoleAssignments = await context.db
      .select({
        role: schoolUserRoleTable.role,
        meta: schoolUserRoleTable.meta,
      })
      .from(schoolUserRoleTable)
      .where(
        and(
          eq(schoolUserRoleTable.schoolId, schoolId),
          eq(schoolUserRoleTable.userId, authenticatedUser.id),
        ),
      );

    roleAssignments.push(
      ...schoolRoleAssignments.map((assignment) => ({
        role: `school.${assignment.role}` as const,
        scope: { kind: 'school' as const, schoolId },
        meta: assignment.meta,
      })),
    );
  }

  const input: AuthorizationInput = {
    ...request,
    subject: {
      userId: authenticatedUser.id,
      roleAssignments,
    },
  };

  let allowed: boolean;
  try {
    allowed = await isAuthorized(input, { signal });
  } catch (error) {
    throw rpcError.internal(error);
  }

  if (!allowed) throw rpcError.forbidden();
}
