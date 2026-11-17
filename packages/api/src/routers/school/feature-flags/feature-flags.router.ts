import { rpcError, toRpcError } from '../../../errors';
import { readSchoolFeatureFlags } from '../../../feature-flags/feature-flags.service';
import { protectedProcedure } from '../../../index';
import { requireSchoolMember } from '../../../permissions/school-member';
import {
  schoolFeatureFlagsDtoSchema,
  schoolFeatureFlagsInputSchema,
} from './feature-flags.dto';

/**
 * Which platform features the school has. Every member needs this to draw
 * the right navigation whatever their role, so it requires membership and no
 * permission. It is read-only: only platform administrators change flags
 * (`systemAdmin.updateSchoolFeatureFlag`).
 */
export const schoolFeatureFlagsRouter = {
  getFeatureFlags: protectedProcedure
    .route({
      summary: 'Get school feature flags',
      description:
        'Read a school\'s subscription tier and which platform features (for example the Cadet Portal or notices) it has, with each feature\'s configuration. Any member of the school may read it; only platform administrators change it.',
      tags: ['School', 'Feature flags'],
    })
    // App chrome with no agent value: tools of a disabled feature already
    // answer with the feature-disabled error.
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'schools' } })
    .input(schoolFeatureFlagsInputSchema)
    .use(requireSchoolMember())
    .output(schoolFeatureFlagsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const flags = await readSchoolFeatureFlags(context.db, input.schoolId);
        // A member's school exists; only a school deleted this instant is missing.
        if (!flags) throw rpcError.notFound('School');
        return { schoolId: input.schoolId, ...flags };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
