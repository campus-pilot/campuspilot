import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { z } from 'zod';

import { toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSchoolMember } from '../../../permissions/school-member';
import { requireSchoolPermission } from '../../../permissions/school';
import {
  SCHOOL_ONBOARDING_STATES,
  completeSchoolOnboardingInputSchema,
} from '../../../school-onboarding/school-onboarding.contract';
import {
  completeSchoolOnboarding,
  readSchoolOnboardingState,
  skipSchoolOnboarding,
} from '../../../school-onboarding/school-onboarding.service';

const schoolIdInputSchema = z.object({ schoolId: z.string().min(1) });

/**
 * The guided setup of a self-created school (docs/school-creation.md,
 * "Guided setup"). Hidden from MCP and the assistant: it is the owner's first
 * walk through the school, in the app.
 */
export const schoolOnboardingRouter = {
  getOnboarding: protectedProcedure
    .route({
      summary: 'Get the school’s guided setup',
      description:
        'Whether the school is offered the guided setup and where it stands: not_offered, pending, skipped or completed. Any member may read it.',
      tags: ['School'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'schools' } })
    .input(schoolIdInputSchema)
    .use(requireSchoolMember())
    .output(z.object({ state: z.enum(SCHOOL_ONBOARDING_STATES) }))
    .handler(async ({ context, input }) => {
      try {
        return { state: await readSchoolOnboardingState(context.db, input.schoolId) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  completeOnboarding: protectedProcedure
    .route({
      summary: 'Finish the school’s guided setup',
      description:
        'Create the first session with its examinations, the chosen classes with section A and their subjects (one Written mode each), and every examination’s plan, in one transaction. Needs the permissions to create sessions, examinations, classes and exam plans. Refused when the guide was already finished or the school already has a session or a class (CONFLICT, data.reason ONBOARDING_SCHOOL_NOT_EMPTY).',
      tags: ['School'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: false, module: 'schools' } })
    .input(completeSchoolOnboardingInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_SESSION))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_EXAM))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_CLASS))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_EXAM_PLAN))
    .output(
      z.object({
        sessionId: z.string(),
        examSlugs: z.array(z.string()),
        classCount: z.number().int(),
        planCount: z.number().int(),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((transaction) => completeSchoolOnboarding(transaction, input, new Date()));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  skipOnboarding: protectedProcedure
    .route({
      summary: 'Set the school’s guided setup aside',
      description:
        'Set up later: the guide stops opening on its own and the school is set up from the app’s screens. It may still be finished while the school has no session and no class.',
      tags: ['School'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: false, module: 'schools' } })
    .input(schoolIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_SESSION))
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ context, input }) => {
      try {
        await context.db.transaction((transaction) => skipSchoolOnboarding(transaction, input.schoolId, new Date()));
        return { ok: true as const };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
