import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import {
  isAuthorized,
  type AuthorizationInput,
  type AuthorizationRequest,
} from '@campuspilot/opa/authorization';
import { and, eq } from 'drizzle-orm';

import type { Context } from '../context';
import { rpcError } from '../errors';

/**
 * Resolves all role assignments for the subject and resource before asking OPA.
 * Multiple school roles are preserved as separate facts, including each row's
 * metadata. System-scoped actions intentionally receive no school-role facts.
 */
export async function assertPermission(
  context: Context,
  request: AuthorizationRequest,
  signal?: AbortSignal,
): Promise<void> {
  const authenticatedUser = context.session?.user;
  if (!authenticatedUser) throw rpcError.unauthorized();

  // early exist if the resource level is system, since system-level actions do not require school role assignments
  if (
    request.resource.level === 'system' &&
    authenticatedUser.role !== 'admin'
  ) {
    throw rpcError.forbidden();
  }

  const roleAssignments =
    request.resource.level === 'system'
      ? [] // no need to fetch school roles for system-level actions, there are present in session
      : await context.db
          .select({
            role: schoolUserRoleTable.role,
            meta: schoolUserRoleTable.meta,
          })
          .from(schoolUserRoleTable)
          .where(
            and(
              eq(schoolUserRoleTable.schoolId, request.resource.schoolId),
              eq(schoolUserRoleTable.userId, authenticatedUser.id),
            ),
          );

  const input: AuthorizationInput = {
    ...request,
    subject: {
      userId: authenticatedUser.id,
      systemRole: authenticatedUser.role ?? null,
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
