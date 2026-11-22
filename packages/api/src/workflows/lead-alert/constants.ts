/**
 * Restate names and keys of the lead alert. Kept free of runtime imports so
 * the API can reference the worker's service by name and type without
 * importing its implementation (see `restate.ts`).
 */

/** The only ingress-callable lead service; it checks the lead row before starting the workflow. */
export const LEAD_CONTROL_SERVICE_NAME = 'LeadControl';
export const LEAD_ALERT_WORKFLOW_NAME = 'leadAlert';

/** Handlers of `LeadControl`; each signature is bound to one. */
export type LeadControlHandler = 'scheduleAlert';

/** The Restate idempotency key of a lead's alert hand-over; every re-send joins the first. */
export function leadAlertIdempotencyKey(leadId: string): string {
  return `lead-alert:${leadId}`;
}

/** Restate workflow key of a lead's alert: one alert per lead, ever. */
export function leadAlertWorkflowKey(leadId: string): string {
  return leadId;
}

/**
 * The WhatsApp template of the alert, registered in Meta on the production
 * Campuspilot account as a Utility template in English (`en`) with named
 * parameters. Its body:
 *
 * "A school has asked for a CampusPilot demo through the website. Contact
 * person: {{name}}, phone {{phone}}, WhatsApp {{whatsapp}}, email {{email}}.
 * School: {{school}}, with {{size}}. They prefer to be contacted by
 * {{contact}}. Please follow up with them soon. Reference {{reference}} in
 * the admin app."
 *
 * Parameter names here must match the template in Meta. Until Meta approves
 * it, sends are refused and the workflow keeps retrying (see `workflow.ts`).
 */
export const LEAD_ALERT_TEMPLATE_NAME = 'demo_lead_alert';
export const LEAD_ALERT_TEMPLATE_LANGUAGE = 'en';
