import { db } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import * as restate from '@restatedev/restate-sdk';

import { buildOnboardingAlertMessage, loadPendingOnboardingAlert, markOnboardingAlertFailed, markOnboardingAlertSent } from '../../leads/school-onboarding.alert';
import { sendTemplateMessage } from '../../notifications/channels/whatsapp/client';
import { SCHOOL_ONBOARDING_ALERT_WORKFLOW_NAME } from './constants';
import { schoolOnboardingAlertInputSchema, type SchoolOnboardingAlertInput } from './input';
import { log } from './log';
import { SEND_STEP_OPTIONS, describeSendFailure, whatsAppConfig, type LeadAlertOutcome } from './workflow';

const DATABASE_STEP_OPTIONS = { maxRetryAttempts: 5, initialRetryInterval: 1_000, retryIntervalFactor: 2, maxRetryInterval: 30_000 } as const;

function databaseStep<T>(ctx: restate.WorkflowContext, name: string, action: () => Promise<T>) {
  return ctx.run(
    name,
    async () => {
      try {
        return await action();
      } catch (error) {
        log.error({ workflow: SCHOOL_ONBOARDING_ALERT_WORKFLOW_NAME, key: ctx.key, step: name, err: error instanceof Error ? error.name : 'unknown' }, 'school-onboarding-alert.step.error');
        throw new Error('A database operation failed; the worker log has the details.');
      }
    },
    DATABASE_STEP_OPTIONS,
  );
}

/**
 * Sends the WhatsApp alert of one School Onboarding submission to the team
 * (`LEAD_ALERT_WHATSAPP_TO`), exactly as `leadAlert` does for a lead: keyed
 * by the request id (one alert per submission, ever), retried for a day, the
 * outcome recorded on the request row. Private to ingress: started only by
 * `LeadControl.scheduleOnboardingAlert`, which checks the row first.
 */
export const schoolOnboardingAlertWorkflow = restate.workflow({
  name: SCHOOL_ONBOARDING_ALERT_WORKFLOW_NAME,
  options: { ingressPrivate: true },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: SchoolOnboardingAlertInput): Promise<LeadAlertOutcome> => {
      const parsed = schoolOnboardingAlertInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid school onboarding alert input.', { errorCode: 400 });
      const { requestId } = parsed.data;
      if (ctx.key !== requestId) throw new restate.TerminalError('The workflow key does not match the request.', { errorCode: 400 });

      const request = await databaseStep(ctx, 'load-request', () => loadPendingOnboardingAlert(db, requestId));
      if (!request) return { status: 'not_pending' };
      const config = whatsAppConfig();
      const to = env.LEAD_ALERT_WHATSAPP_TO;
      if (!config || !to) {
        const reason = !config ? 'WhatsApp sending is switched off (WHATSAPP_ENABLED).' : 'No alert number is configured (LEAD_ALERT_WHATSAPP_TO).';
        await databaseStep(ctx, 'mark-failed', () => markOnboardingAlertFailed(db, requestId, reason));
        log.warn({ requestId, reason }, 'school-onboarding-alert.not-configured');
        return { status: 'failed' };
      }
      let messageId: string;
      try {
        messageId = await ctx.run(
          'send-whatsapp',
          async () => {
            const result = await sendTemplateMessage(config, fetch, buildOnboardingAlertMessage(request, to));
            if (result.ok) return result.messageId;
            const reason = describeSendFailure(result.error);
            log.warn({ requestId, reason }, 'school-onboarding-alert.send.retry');
            throw new Error(reason);
          },
          SEND_STEP_OPTIONS,
        );
      } catch (error) {
        if (!(error instanceof restate.TerminalError)) throw error;
        const reason = `Gave up after retrying for a day. Last error: ${error.message}`;
        await databaseStep(ctx, 'mark-failed', () => markOnboardingAlertFailed(db, requestId, reason));
        log.error({ requestId, reason }, 'school-onboarding-alert.failed');
        return { status: 'failed' };
      }
      await databaseStep(ctx, 'mark-sent', () => markOnboardingAlertSent(db, requestId, messageId));
      log.info({ requestId }, 'school-onboarding-alert.sent');
      return { status: 'sent' };
    },
  },
});
