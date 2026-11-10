import { schoolTable } from '@campuspilot/db/schema/school';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { eq } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../../errors';
import {
  getSchoolFeatureFlags,
  setSchoolFeature,
} from '../../../feature-flags/feature-flags.service';
import { protectedProcedure } from '../../../index';
import { requireSystemPermission } from '../../../permissions/system';
import {
  adminSchoolFeatureFlagsDtoSchema,
  adminSchoolFeatureFlagsInputSchema,
  updateSchoolFeatureFlagInputSchema,
} from './feature-flags.dto';

/**
 * Platform administration of per-school feature flags. Reading and changing
 * are separate system actions; a school's own staff can only read their
 * flags (`school.getFeatureFlags`).
 */
export const featureFlagsRouter = {
  getSchoolFeatureFlags: protectedProcedure
    .route({
      summary: 'Get a school\'s feature flags',
      description:
        'Read which platform features are enabled for one school and each feature\'s configuration. Features without a stored value are disabled. Requires system-administrator permission.',
      tags: ['System Admin', 'Feature flags'],
    })
    .meta({ mcp: { exposure: 'advanced', access: 'read', destructive: false, module: 'platform' } })
    .input(adminSchoolFeatureFlagsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL_FEATURE_FLAGS))
    .output(adminSchoolFeatureFlagsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select({ id: schoolTable.id })
          .from(schoolTable)
          .where(eq(schoolTable.id, input.id))
          .limit(1);
        if (!school) throw rpcError.notFound('School');
        return {
          schoolId: school.id,
          features: await getSchoolFeatureFlags(context.db, school.id),
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSchoolFeatureFlag: protectedProcedure
    .route({
      summary: 'Update a school\'s feature flag',
      description:
        'Enable or disable one platform feature for a school and store its configuration. Disabling the Cadet Portal feature stops student sign-in and portal access for that school at once; existing data is kept. Requires system-administrator permission.',
      tags: ['System Admin', 'Feature flags'],
    })
    // Hidden from MCP: switching a school's features on or off is a platform
    // decision that stays a human action in the admin app. (Its input is also
    // a discriminated union, which MCP tools cannot take as a top-level object.)
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'platform' } })
    .input(updateSchoolFeatureFlagInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL_FEATURE_FLAGS))
    .output(adminSchoolFeatureFlagsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          // The school row is locked so two administrators changing flags of
          // one school are applied one after the other, and a concurrent demo
          // purge cannot delete the school underneath the write.
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.id))
            .limit(1)
            .for('update');
          if (!school) throw rpcError.notFound('School');
          // Spread, not field by field: the input is a union discriminated on
          // `feature`, and spreading keeps each key paired with its own config.
          const { id: _schoolId, ...update } = input;
          await setSchoolFeature(transaction, {
            ...update,
            schoolId: school.id,
            updatedBy: context.session.user.id,
          });
          return {
            schoolId: school.id,
            features: await getSchoolFeatureFlags(transaction, school.id),
          };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
