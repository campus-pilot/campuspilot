import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import {
  isAuthorized,
  type AuthorizationAction,
  type AuthorizationInput,
  type AuthorizationRequest,
  type AuthorizationResourceByAction,
  type RoleAssignment,
} from '@campuspilot/opa/authorization';
import { and, eq, inArray } from 'drizzle-orm';

import type { Context } from '../context';
import { rpcError } from '../errors';

/**
 * Resolves all role assignments for the subject and resource before asking OPA.
 * Multiple school roles are preserved as separate facts, including each row's
 * metadata. Every assignment carries its explicit runtime scope; namespaced
 * roles identify the role vocabulary independently of that scope.
 */
export async function assertPermission<TAction extends AuthorizationAction>(
  context: Context,
  request: {
    action: TAction;
    resource: AuthorizationResourceByAction[TAction];
  },
  signal?: AbortSignal,
): Promise<void> {
  // The generic preserves the action/resource correlation at the call site.
  // The generated distributive union cannot represent an unresolved generic
  // action until that action is narrowed by the caller.
  const [allowed] = await checkPermissions(
    context,
    [request as AuthorizationRequest],
    signal,
  );

  if (!allowed) throw rpcError.forbidden();
}

/**
 * Evaluates several permission requests while resolving the subject's role
 * assignments only once. Results preserve request order so callers can safely
 * associate every decision with the permission at the same array index.
 */
export async function checkPermissions(
  context: Context,
  requests: readonly AuthorizationRequest[],
  signal?: AbortSignal,
): Promise<boolean[]> {
  const authenticatedUser = context.session?.user;
  if (!authenticatedUser) throw rpcError.unauthorized();

  const platformRoleAssignments: RoleAssignment[] = [
    ...(authenticatedUser.role
      ? [
          {
            role: `platform.${authenticatedUser.role}` as const,
            scope: { kind: 'platform' as const },
          },
        ]
      : []),
  ];

  const schoolIds = [
    ...new Set(
      requests.flatMap(({ resource }) =>
        resource.kind === 'system' ? [] : [resource.schoolId],
      ),
    ),
  ];
  const schoolRoleRows =
    schoolIds.length === 0
      ? []
      : await context.db
          .select({
            schoolId: schoolUserRoleTable.schoolId,
            role: schoolUserRoleTable.role,
            meta: schoolUserRoleTable.meta,
          })
          .from(schoolUserRoleTable)
          .where(
            and(
              eq(schoolUserRoleTable.userId, authenticatedUser.id),
              inArray(schoolUserRoleTable.schoolId, schoolIds),
            ),
          );

  const schoolRoleAssignments = new Map<string, RoleAssignment[]>();
  for (const assignment of schoolRoleRows) {
    const assignments = schoolRoleAssignments.get(assignment.schoolId) ?? [];
    assignments.push({
      role: `school.${assignment.role}` as const,
      scope: { kind: 'school', schoolId: assignment.schoolId },
      meta: assignment.meta,
    });
    schoolRoleAssignments.set(assignment.schoolId, assignments);
  }

  const inputs: AuthorizationInput[] = requests.map((request) => {
    const schoolAssignments =
      request.resource.kind === 'system'
        ? []
        : (schoolRoleAssignments.get(request.resource.schoolId) ?? []);

    return {
      ...request,
      subject: {
        userId: authenticatedUser.id,
        roleAssignments: [...platformRoleAssignments, ...schoolAssignments],
      },
    };
  });

  try {
    return await Promise.all(
      inputs.map((input) => isAuthorized(input, { signal })),
    );
  } catch (error) {
    throw rpcError.internal(error);
  }
}
