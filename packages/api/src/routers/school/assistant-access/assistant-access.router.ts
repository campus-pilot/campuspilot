import type { DatabaseExecutor } from '@campuspilot/db';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';

import { applyAssistantRoleChanges, readAssistantRoleStates } from '../../../assistant/roles';
import { toRpcError } from '../../../errors';
import { getSchoolFeatureConfig } from '../../../feature-flags/feature-flags.service';
import { protectedProcedure } from '../../../index';
import { requireSchoolFeature } from '../../../permissions/feature';
import { requireSchoolPermission } from '../../../permissions/school';
import { assistantUsageSchema, schoolAssistantUsage } from '../../../assistant/usage';
import {
  assistantAccessDtoSchema,
  assistantAccessInputSchema,
  schoolAssistantUsageInputSchema,
  updateAssistantRolesInputSchema,
  type AssistantAccessDto,
} from './assistant-access.dto';

/**
 * The school's assistant role list as the settings screen shows it, with the
 * monthly limit from the feature's config (CONFLICT when that is unusable,
 * like every config reader).
 */
async function readAssistantAccess(db: DatabaseExecutor, schoolId: string): Promise<AssistantAccessDto> {
  const config = await getSchoolFeatureConfig(db, schoolId, 'assistant');
  return {
    schoolId,
    roles: await readAssistantRoleStates(db, schoolId),
    monthlyLimitUsd: config?.monthlyLimitUsd ?? null,
  };
}

/**
 * Which school roles may use the in-app assistant, managed by the school's
 * principal or manager. It is the same list the platform administrator
 * edits in the admin app (`systemAdmin.updateSchoolAssistantRoles`): either
 * may switch any role on or off, and each sees what the other saved. Both
 * procedures are behind the `assistant` feature (after the permission
 * check) and are human settings, so they are hidden from MCP and never
 * offered to the assistant itself.
 */
export const schoolAssistantAccessRouter = {
  getAssistantAccess: protectedProcedure
    .route({
      summary: 'Get assistant access',
      description:
        'Read which school roles may use the in-app AI assistant (for every role, whether the assistant is switched on for it) and the school’s monthly spend limit.',
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
        'Switch the in-app AI assistant on or off for school roles. Any role can be switched either way. Roles not listed keep their state.',
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
          await applyAssistantRoleChanges(tx, { schoolId: input.schoolId, changes: input.roles, updatedBy: userId });
          return readAssistantAccess(tx, input.schoolId);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getAssistantUsage: protectedProcedure
    .route({
      summary: 'Get assistant usage',
      description:
        'Read what the in-app AI assistant cost the school per IST calendar day over a range (USD, from the costs saved with every model request), with request and token counts. May be up to an hour behind unless `refresh` is set, which computes it again.',
      tags: ['School', 'Assistant'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'schools' } })
    .input(schoolAssistantUsageInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ASSISTANT_USAGE))
    .use(requireSchoolFeature('assistant'))
    .output(assistantUsageSchema)
    .handler(async ({ context, input }) => {
      try {
        return await schoolAssistantUsage(context.db, input.schoolId, { from: input.from, to: input.to }, { refresh: input.refresh });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
