import type { DatabaseExecutor } from '@campuspilot/db';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env as assistantEnv, isAssistantVoiceConfigured } from '@campuspilot/env/assistant';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { rpcError, toRpcError } from '../../../errors';
import {
  readSchoolFeatureFlags,
  setSchoolFeature,
} from '../../../feature-flags/feature-flags.service';
import { protectedProcedure } from '../../../index';
import { requireSystemPermission } from '../../../permissions/system';
import {
  adminSchoolFeatureFlagsDtoSchema,
  adminSchoolFeatureFlagsInputSchema,
  updateSchoolFeatureFlagInputSchema,
  updateSchoolTierInputSchema,
} from './feature-flags.dto';

/**
 * A school's tier, features and unusable configs as the admin editor shows
 * them. A school that does not exist is NOT_FOUND.
 */
async function readAdminSchoolFeatureFlags(db: DatabaseExecutor, schoolId: string) {
  const flags = await readSchoolFeatureFlags(db, schoolId);
  if (!flags) throw rpcError.notFound('School');
  return { schoolId, ...flags };
}

/**
 * Platform administration of a school's features: its subscription tier and
 * its per-school adjustments. Reading and changing are separate system
 * actions; a school's own staff can only read their features
 * (`school.getFeatureFlags`).
 */
export const featureFlagsRouter = {
  getSchoolFeatureFlags: protectedProcedure
    .route({
      summary: 'Get a school\'s feature flags',
      description:
        'Read one school\'s plan (its subscribed tier, its active trial and the tier they give) and, for every platform feature, whether that tier includes it, the school\'s own adjustment, whether the school has it now, and its configuration. Requires system-administrator permission.',
      tags: ['System Admin', 'Feature flags'],
    })
    .meta({ mcp: { exposure: 'advanced', access: 'read', destructive: false, module: 'platform' } })
    .input(adminSchoolFeatureFlagsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL_FEATURE_FLAGS))
    .output(adminSchoolFeatureFlagsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await readAdminSchoolFeatureFlags(context.db, input.id);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getAssistantPlatformStatus: protectedProcedure
    .route({
      summary: 'Get the platform\'s assistant setup',
      description:
        'Read whether this deployment has a voice model configured. Without one, no school has voice mode, whatever its assistant settings say. Requires system-administrator permission.',
      tags: ['System Admin', 'Feature flags'],
    })
    // Hidden from MCP: it describes the deployment's configuration, which only
    // the admin app's settings pages need.
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'platform' } })
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL_FEATURE_FLAGS))
    .output(z.object({ voiceConfigured: z.boolean() }))
    .handler(() => ({ voiceConfigured: isAssistantVoiceConfigured(assistantEnv) })),

  updateSchoolFeatureFlag: protectedProcedure
    .route({
      summary: 'Update a school\'s feature flag',
      description:
        'Adjust one platform feature for a school on top of its subscription tier (on, off, or back to what the tier includes) and store its configuration. Switching the Cadet Portal off stops student sign-in and portal access for that school at once; existing data is kept. Requires system-administrator permission.',
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
          return await readAdminSchoolFeatureFlags(transaction, school.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSchoolTier: protectedProcedure
    .route({
      summary: 'Change a school\'s subscription tier',
      description:
        'Move a school to another subscribed tier (plus, pro or enterprise), or remove its subscription (null). The school then has the features of its plan: the higher of the new tier and an active trial\'s tier; without either it has no plan and is read-only. Features an administrator adjusted for this school stay as adjusted. A change that takes a feature away stops it for the school at once; existing data is kept. Requires system-administrator permission.',
      tags: ['System Admin', 'Feature flags'],
    })
    // Hidden from MCP for the same reason as a flag update: what a school
    // pays for and has is a human platform decision.
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'platform' } })
    .input(updateSchoolTierInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL_FEATURE_FLAGS))
    .output(adminSchoolFeatureFlagsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          // Locked for the same reason as a flag update.
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.id))
            .limit(1)
            .for('update');
          if (!school) throw rpcError.notFound('School');
          // The subscribed tier only (null removes the subscription).
          // Adjustments are the administrator's separate decisions about
          // this school and are not touched: a feature switched on for it
          // stays on, one switched off stays off. Trials are not touched either.
          await transaction
            .update(schoolTable)
            .set({ tier: input.tier, updatedAt: new Date() })
            .where(eq(schoolTable.id, school.id));
          return await readAdminSchoolFeatureFlags(transaction, school.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
