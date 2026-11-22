import { schoolTable } from '@campuspilot/db/schema/school';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  applyAssistantRoleChanges,
  assistantRoleChangesSchema,
  assistantRoleStateSchema,
  readAssistantRoleStates,
} from '../../../assistant/roles';
import { rpcError, toRpcError } from '../../../errors';
import { platformAdminProcedure } from '../../../index';
import { requireSystemPermission } from '../../../permissions/system';

/** The system admin router names the school `id`, like `getSchool`. */
const schoolAssistantRolesInputSchema = z.object({ id: z.string().min(1) });

const updateSchoolAssistantRolesInputSchema = z.object({
  id: z.string().min(1),
  /** The roles to switch on or off; roles not listed keep their state. */
  roles: assistantRoleChangesSchema,
});

/** Every school role, in the platform's role order, with whether the assistant is switched on for it. */
export const schoolAssistantRolesDtoSchema = z.object({
  schoolId: z.string(),
  roles: z.array(assistantRoleStateSchema),
});
export type SchoolAssistantRolesDto = z.infer<typeof schoolAssistantRolesDtoSchema>;

/**
 * A school's assistant role list, for platform administrators (admin app,
 * School › AI). It is the very list the school's principal or manager edits
 * in their own settings (`school.updateAssistantRoles`): one list, two
 * editors, so the two screens always show the same roles.
 *
 * The roles belong to the school's assistant settings, so they use the
 * feature flag permissions (`system.school.feature_flags.*`). They can be
 * read and changed whether or not the assistant is switched on: an
 * administrator may prepare them before enabling it. Hidden from MCP, like
 * every assistant setting.
 */
export const assistantAccessRouter = {
  getSchoolAssistantRoles: platformAdminProcedure
    .route({
      summary: 'Get a school\'s assistant roles',
      description:
        'Read which school roles may use the in-app AI assistant in one school: for every role, whether the assistant is switched on for it. Requires system-administrator permission.',
      tags: ['System Admin', 'Assistant'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'platform' } })
    .input(schoolAssistantRolesInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL_FEATURE_FLAGS))
    .output(schoolAssistantRolesDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select({ id: schoolTable.id })
          .from(schoolTable)
          .where(eq(schoolTable.id, input.id))
          .limit(1);
        if (!school) throw rpcError.notFound('School');
        return { schoolId: school.id, roles: await readAssistantRoleStates(context.db, school.id) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSchoolAssistantRoles: platformAdminProcedure
    .route({
      summary: 'Update a school\'s assistant roles',
      description:
        'Switch the in-app AI assistant on or off for school roles of one school. The school\'s principal or manager edits the same list in the school\'s settings. Roles not listed keep their state. Requires system-administrator permission.',
      tags: ['System Admin', 'Assistant'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'platform' } })
    .input(updateSchoolAssistantRolesInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL_FEATURE_FLAGS))
    .output(schoolAssistantRolesDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          // Locked like a flag update, so it is applied in order with an
          // administrator enabling the assistant (which may write the default roles).
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.id))
            .limit(1)
            .for('update');
          if (!school) throw rpcError.notFound('School');
          await applyAssistantRoleChanges(transaction, {
            schoolId: school.id,
            changes: input.roles,
            updatedBy: context.session.user.id,
          });
          return { schoolId: school.id, roles: await readAssistantRoleStates(transaction, school.id) };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
