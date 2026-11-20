import { db } from '@campuspilot/db';
import { env } from '@campuspilot/env/server';
import * as restate from '@restatedev/restate-sdk';

import { buildLeadAlertMessage } from '../../leads/lead-alert-message';
import { loadPendingLeadAlert, markLeadAlertFailed, markLeadAlertSent } from '../../leads/lead-store';
import { sendTemplateMessage, type WhatsAppApiError, type WhatsAppClientConfig, type WhatsAppTransportError } from '../../notifications/channels/whatsapp/client';
import { LEAD_ALERT_WORKFLOW_NAME, leadAlertWorkflowKey } from './constants';
import { leadAlertInputSchema, type LeadAlertInput } from './input';
import { log } from './log';

/** Bounded retries for database steps. */
const DATABASE_STEP_OPTIONS = { maxRetryAttempts: 5, initialRetryInterval: 1_000, retryIntervalFactor: 2, maxRetryInterval: 30_000 } as const;

/**
 * Retries of the WhatsApp send: every failure is retried, with backoff up to
 * 30 minutes, for a day. A lead alert goes to the team's own number, so the
 * cost of a duplicate (a send whose outcome was unknown, retried) is one
 * extra message, while giving up early loses a lead alert; and a refusal
 * that looks permanent, such as the template still awaiting Meta's approval
 * or a paused number, usually resolves within that day.
 */
const SEND_STEP_OPTIONS = {
  initialRetryInterval: 30_000,
  retryIntervalFactor: 2,
  maxRetryInterval: 30 * 60_000,
  maxRetryDuration: 24 * 60 * 60_000,
} as const;

export type LeadAlertOutcome = { status: 'sent' | 'failed' | 'not_pending' };

/** The Cloud API client settings, or null while WhatsApp sending is not set up. */
function whatsAppConfig(): WhatsAppClientConfig | null {
  if (!env.WHATSAPP_ENABLED || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_GRAPH_API_VERSION) return null;
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
    graphBaseUrl: env.WHATSAPP_GRAPH_BASE_URL,
  };
}

/** Safe one-line reason of a failed send (Meta's code, never the request). */
function describeSendFailure(error: WhatsAppApiError | WhatsAppTransportError) {
  if (error === 'connect_failed') return 'WhatsApp could not be reached.';
  if (error === 'outcome_unknown') return 'WhatsApp did not confirm the message.';
  return `WhatsApp refused the message (${error.code !== null ? `wa_${error.code}` : `http_${error.status}`}).`;
}

/** Journals a database step; Restate stores the error text, so it is replaced by a generic one. */
function databaseStep<T>(ctx: restate.WorkflowContext, name: string, action: () => Promise<T>) {
  return ctx.run(
    name,
    async () => {
      try {
        return await action();
      } catch (error) {
        log.error({ workflow: LEAD_ALERT_WORKFLOW_NAME, key: ctx.key, step: name, err: error instanceof Error ? error.name : 'unknown' }, 'lead-alert.step.error');
        throw new Error('A database operation failed; the worker log has the details.');
      }
    },
    DATABASE_STEP_OPTIONS,
  );
}

/**
 * Sends the WhatsApp alert of one new lead to the team
 * (`LEAD_ALERT_WHATSAPP_TO`). Keyed by the lead id, so a lead is alerted by
 * one workflow run ever. Private to ingress: only `LeadControl`, which checks
 * the lead row first, starts it. The lead row carries the outcome (`sent`
 * with the message id, or `failed` with a safe reason), so the workflow
 * returns normally for an alert that could not be sent.
 */
export const leadAlertWorkflow = restate.workflow({
  name: LEAD_ALERT_WORKFLOW_NAME,
  options: { ingressPrivate: true },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: LeadAlertInput): Promise<LeadAlertOutcome> => {
      const parsed = leadAlertInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid lead alert input.', { errorCode: 400 });
      const { leadId } = parsed.data;
      if (ctx.key !== leadAlertWorkflowKey(leadId)) throw new restate.TerminalError('The workflow key does not match the lead.', { errorCode: 400 });

      const lead = await databaseStep(ctx, 'load-lead', () => loadPendingLeadAlert(db, leadId));
      if (!lead) return { status: 'not_pending' };
      const config = whatsAppConfig();
      const to = env.LEAD_ALERT_WHATSAPP_TO;
      if (!config || !to) {
        const reason = !config ? 'WhatsApp sending is switched off (WHATSAPP_ENABLED).' : 'No alert number is configured (LEAD_ALERT_WHATSAPP_TO).';
        await databaseStep(ctx, 'mark-failed', () => markLeadAlertFailed(db, leadId, reason));
        log.warn({ leadId, reason }, 'lead-alert.not-configured');
        return { status: 'failed' };
      }

      let messageId: string;
      try {
        messageId = await ctx.run(
          'send-whatsapp',
          async () => {
            const result = await sendTemplateMessage(config, fetch, buildLeadAlertMessage(lead, to));
            if (result.ok) return result.messageId;
            const reason = describeSendFailure(result.error);
            log.warn({ leadId, reason }, 'lead-alert.send.retry');
            throw new Error(reason);
          },
          SEND_STEP_OPTIONS,
        );
      } catch (error) {
        if (!(error instanceof restate.TerminalError)) throw error;
        const reason = `Gave up after retrying for a day. Last error: ${error.message}`;
        await databaseStep(ctx, 'mark-failed', () => markLeadAlertFailed(db, leadId, reason));
        log.error({ leadId, reason }, 'lead-alert.failed');
        return { status: 'failed' };
      }
      await databaseStep(ctx, 'mark-sent', () => markLeadAlertSent(db, leadId, messageId));
      log.info({ leadId }, 'lead-alert.sent');
      return { status: 'sent' };
    },
  },
});

export type LeadAlertWorkflow = typeof leadAlertWorkflow;
