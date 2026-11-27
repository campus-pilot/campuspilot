import type { DatabaseExecutor } from '@campuspilot/db';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';

import { applyAssistantRoleChanges, readAssistantRoleStates } from '../../../assistant/roles';
import { toRpcError } from '../../../errors';
import { getSchoolFeatureConfig } from '../../../feature-flags/feature-flags.service';
import { protectedProcedure } from '../../../index';
import { requireSchoolFeature } from '../../../permissions/feature';
import { requireSchoolPermission } from '../../../permissions/school';
import { readSchoolAssistantAllowance } from '../../../assistant/allowance';
import {
  assistantAccessDtoSchema,
  assistantAccessInputSchema,
  schoolAssistantAllowanceInputSchema,
  schoolAssistantAllowanceSchema,
  updateAssistantRolesInputSchema,
  type AssistantAccessDto,
} from './assistant-access.dto';

/**
 * The school's assistant role list as the settings screen shows it, with
 * whether the feature's config sets a limit (CONFLICT when that config is
 * unusable, like every config reader). Never the limit's amount.
 */
async function readAssistantAccess(db: DatabaseExecutor, schoolId: string): Promise<AssistantAccessDto> {
  const config = await getSchoolFeatureConfig(db, schoolId, 'assistant');
  return {
    schoolId,
    roles: await readAssistantRoleStates(db, schoolId),
    limited: (config?.monthlyLimitUsd ?? null) !== null,
  };
}

/**
 * Which school roles may use the in-app assistant, managed by the school's
 * principal or manager. It is the same list the platform administrator
 * edits in the admin app (`systemAdmin.updateSchoolAssistantRoles`): either
 * may switch any role on or off, and each sees what the other saved. With
 * the school's AI allowance (`getAssistantAllowance`), every procedure here
 * is behind the `assistant` feature (after the permission check) and is a
 * human setting, so hidden from MCP and never offered to the assistant
 * itself. None returns an amount of money: schools see their AI use only as
 * a percentage of the allowance.
 */
export const schoolAssistantAccessRouter = {
  getAssistantAccess: protectedProcedure
    .route({
      summary: 'Get assistant access',
      description:
        'Read which school roles may use the in-app AI assistant (for every role, whether the assistant is switched on for it) and whether the school’s plan limits its AI use.',
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

  getAssistantAllowance: protectedProcedure
    .route({
      summary: 'Get assistant allowance',
      description:
        'Read how much of the current period’s AI allowance the school has used, as a percentage, when it resets, and each person’s share of it. Never amounts of money. The total may be up to 10 minutes old.',
      tags: ['School', 'Assistant'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'schools' } })
    .input(schoolAssistantAllowanceInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ASSISTANT_USAGE))
    .use(requireSchoolFeature('assistant'))
    .output(schoolAssistantAllowanceSchema)
    .handler(async ({ context, input }) => {
      try {
        return await readSchoolAssistantAllowance(context.db, input.schoolId);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
