import { db } from '@campuspilot/db';
import * as restate from '@restatedev/restate-sdk';

import { loadPendingLeadAlert } from '../../leads/lead-store';
import { loadPendingOnboardingAlert } from '../../leads/school-onboarding.alert';
import { authenticateControlCall } from '../control-service-auth';
import { LEAD_CONTROL_SERVICE_NAME, leadAlertWorkflowKey, type LeadControlHandler } from './constants';
import { leadAlertInputSchema, schoolOnboardingAlertInputSchema, type LeadAlertInput, type SchoolOnboardingAlertInput } from './input';
import { log } from './log';
import { schoolOnboardingAlertWorkflow } from './onboarding-workflow';
import { leadAlertWorkflow } from './workflow';

/**
 * `LeadControl` is the only lead service reachable through Restate ingress;
 * the alert workflow is `ingressPrivate`. The API schedules a saved lead's
 * alert with a one-way, idempotent, signed send (the outbox in
 * `leads/lead.outbox.ts`), so no submission waits for the worker.
 * `scheduleAlert` is, in order: Zod-parsed (malformed input fails terminally
 * at once), authenticated by its HMAC signature (`WORKER_CONTROL_SECRET`,
 * bound to this service and handler), checked against the database (the
 * lead exists and its alert is pending), and only then starts the workflow
 * under the lead's key. It trusts the caller for nothing beyond the lead id.
 */
export const leadControlService = restate.service({
  name: LEAD_CONTROL_SERVICE_NAME,
  handlers: {
    scheduleAlert: async (ctx: restate.Context, rawInput: LeadAlertInput): Promise<{ invocationId: string }> => {
      const parsed = leadAlertInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid lead alert request.', { errorCode: 400 });
      const input = parsed.data;
      const handler: LeadControlHandler = 'scheduleAlert';
      await authenticateControlCall(ctx, { service: LEAD_CONTROL_SERVICE_NAME, handler, input, log });
      const pending = await ctx.run(
        'validate-lead',
        async () => {
          try {
            return Boolean(await loadPendingLeadAlert(db, input.leadId));
          } catch (error) {
            log.error({ service: LEAD_CONTROL_SERVICE_NAME, err: error instanceof Error ? error.name : 'unknown' }, 'lead-alert.control.error');
            throw new Error('A database operation failed; the worker log has the details.');
          }
        },
        { maxRetryAttempts: 5 },
      );
      if (!pending) throw new restate.TerminalError('No lead with a pending alert matches this id.', { errorCode: 409 });
      const handle = ctx.workflowSendClient(leadAlertWorkflow, leadAlertWorkflowKey(input.leadId)).run(input);
      return { invocationId: await handle.invocationId };
    },

    /** As `scheduleAlert`, for a School Onboarding submission whose alert is pending. */
    scheduleOnboardingAlert: async (ctx: restate.Context, rawInput: SchoolOnboardingAlertInput): Promise<{ invocationId: string }> => {
      const parsed = schoolOnboardingAlertInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid school onboarding alert request.', { errorCode: 400 });
      const input = parsed.data;
      const handler: LeadControlHandler = 'scheduleOnboardingAlert';
      await authenticateControlCall(ctx, { service: LEAD_CONTROL_SERVICE_NAME, handler, input, log });
      const pending = await ctx.run(
        'validate-request',
        async () => {
          try {
            return Boolean(await loadPendingOnboardingAlert(db, input.requestId));
          } catch (error) {
            log.error({ service: LEAD_CONTROL_SERVICE_NAME, err: error instanceof Error ? error.name : 'unknown' }, 'school-onboarding-alert.control.error');
            throw new Error('A database operation failed; the worker log has the details.');
          }
        },
        { maxRetryAttempts: 5 },
      );
      if (!pending) throw new restate.TerminalError('No submission with a pending alert matches this id.', { errorCode: 409 });
      const handle = ctx.workflowSendClient(schoolOnboardingAlertWorkflow, input.requestId).run(input);
      return { invocationId: await handle.invocationId };
    },
  },
});

export type LeadControlService = typeof leadControlService;
