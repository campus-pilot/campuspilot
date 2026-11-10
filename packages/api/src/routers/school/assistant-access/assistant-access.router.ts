import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import { roles, type Role } from '@campuspilot/db/schema/jsonb/role';
import type { DatabaseExecutor } from '@campuspilot/db';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, eq, inArray } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../../errors';
import { getSchoolFeatureConfig } from '../../../feature-flags/feature-flags.service';
import { protectedProcedure } from '../../../index';
import { requireSchoolFeature } from '../../../permissions/feature';
import { requireSchoolPermission } from '../../../permissions/school';
import {
  assistantAccessDtoSchema,
  assistantAccessInputSchema,
  updateAssistantRolesInputSchema,
  type AssistantAccessDto,
} from './assistant-access.dto';

/**
 * The school's assistant role list as the settings screen shows it. Reads
 * the feature's config (CONFLICT when it is unusable, like every config
 * reader) and the school's stored choices, and reports both facts per role.
 */
async function readAssistantAccess(db: DatabaseExecutor, schoolId: string): Promise<AssistantAccessDto> {
  const config = await getSchoolFeatureConfig(db, schoolId, 'assistant');
  const eligible = new Set<Role>(config?.eligibleRoles ?? []);
  const enabled = new Set<Role>(
    (
      await db
        .select({ role: schoolAssistantAccessRoleTable.role })
        .from(schoolAssistantAccessRoleTable)
        .where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId))
    ).map((row) => row.role),
  );
  return {
    schoolId,
    roles: roles.map((role) => ({ role, eligible: eligible.has(role), enabled: enabled.has(role) })),
    monthlyLimitUsd: config?.monthlyLimitUsd ?? null,
  };
}

/**
 * Which school roles may use the in-app assistant, managed by the school's
 * principal or manager. The platform decides the ceiling (`eligibleRoles`
 * on the `assistant` feature flag, admin app); the school switches each
 * eligible role on or off. Both procedures are behind the `assistant`
 * feature (after the permission check) and are human settings, so they are
 * hidden from MCP and never offered to the assistant itself.
 */
export const schoolAssistantAccessRouter = {
  getAssistantAccess: protectedProcedure
    .route({
      summary: 'Get assistant access',
      description:
        'Read which school roles may use the in-app AI assistant: for every role, whether the platform made it eligible and whether the school switched it on, and the school’s monthly spend limit.',
      tags: ['School', 'Assistant'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'schools' } })
    .input(assistantAccessInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ASSISTANT_ACCESS))
    .use(requireSchoolFeature('assistant'))
    .output(assistantAccessDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await readAssistantAccess(context.db, input.schoolId);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateAssistantRoles: protectedProcedure
    .route({
      summary: 'Update assistant roles',
      description:
        'Switch the in-app AI assistant on or off for school roles. Only roles the platform made eligible can be switched on; any switched-on role can be switched off. Roles not listed keep their state.',
      tags: ['School', 'Assistant'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'schools' } })
    .input(updateAssistantRolesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.MANAGE_ASSISTANT_ACCESS))
    .use(requireSchoolFeature('assistant'))
    .output(assistantAccessDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const userId = context.session!.user.id;
        return await context.db.transaction(async (tx) => {
          const config = await getSchoolFeatureConfig(tx, input.schoolId, 'assistant');
          const eligible = new Set<Role>(config?.eligibleRoles ?? []);
          const notEligible = input.roles.filter((change) => change.enabled && !eligible.has(change.role));
          if (notEligible.length > 0) {
            throw rpcError.badRequest(
              `The assistant is not available on your plan for: ${notEligible.map((change) => change.role).join(', ')}.`,
            );
          }
          const on = input.roles.filter((change) => change.enabled).map((change) => change.role);
          const off = input.roles.filter((change) => !change.enabled).map((change) => change.role);
          if (on.length > 0) {
            await tx
              .insert(schoolAssistantAccessRoleTable)
              .values(on.map((role) => ({ schoolId: input.schoolId, role, updatedBy: userId, updatedAt: new Date() })))
              .onConflictDoNothing();
          }
          if (off.length > 0) {
            await tx
              .delete(schoolAssistantAccessRoleTable)
              .where(
                and(eq(schoolAssistantAccessRoleTable.schoolId, input.schoolId), inArray(schoolAssistantAccessRoleTable.role, off)),
              );
          }
          return readAssistantAccess(tx, input.schoolId);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
