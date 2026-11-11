import { schoolTable } from '@campuspilot/db/schema/school';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  platformAssistantUsage,
  platformAssistantUsageSchema,
  schoolAssistantUsageDetail,
  schoolAssistantUsageDetailSchema,
  withUsageRange,
} from '../../../assistant/usage';
import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSystemPermission } from '../../../permissions/system';

/**
 * What the in-app assistant costs, for platform administrators: one school's
 * AI page and the platform-wide AI billing page. Amounts are the costs saved
 * with every model request (USD), per IST calendar day, cached for an hour.
 * `refresh` computes the figures again and replaces the cached answer.
 * A school's assistant settings are its `assistant` feature flag
 * (`updateSchoolFeatureFlag`), not these procedures.
 */
export const assistantUsageRouter = {
  getSchoolAssistantUsage: protectedProcedure
    .route({
      summary: 'Get a school\'s assistant usage',
      description:
        'Read what the in-app AI assistant cost one school per IST day over a range, per model with the prices used, and its top users. Cached for an hour unless `refresh` is set. Requires system-administrator permission.',
      tags: ['System Admin', 'Assistant'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'platform' } })
    .input(withUsageRange({ id: z.string().min(1) }))
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_PLATFORM_ASSISTANT_USAGE))
    .output(schoolAssistantUsageDetailSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, input.id)).limit(1);
        if (!school) throw rpcError.notFound('School');
        return await schoolAssistantUsageDetail(context.db, school.id, { from: input.from, to: input.to }, { refresh: input.refresh });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getPlatformAssistantUsage: protectedProcedure
    .route({
      summary: 'Get platform assistant usage',
      description:
        'Read what the in-app AI assistant cost the whole platform per IST day over a range: totals per provider and model with tokens, requests and the prices used, and per school. Cached for an hour unless `refresh` is set. For comparing with each provider\'s billing console. Requires system-administrator permission.',
      tags: ['System Admin', 'Assistant'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'platform' } })
    .input(withUsageRange({}))
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_PLATFORM_ASSISTANT_USAGE))
    .output(platformAssistantUsageSchema)
    .handler(async ({ context, input }) => {
      try {
        return await platformAssistantUsage(context.db, { from: input.from, to: input.to }, { refresh: input.refresh });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
