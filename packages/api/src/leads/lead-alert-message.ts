import { formatPhoneNumberForDisplay } from '@campuspilot/db/phone';

import { templateParam } from '../notifications/channels/whatsapp/templates';
import type { TemplateMessage } from '../notifications/channels/whatsapp/client';
import { LEAD_ALERT_TEMPLATE_LANGUAGE, LEAD_ALERT_TEMPLATE_NAME } from '../workflows/lead-alert/constants';
import { DEMO_REQUEST_FORM, PREFERRED_CONTACT_LABELS, type PreferredContactMethod } from './demo-request';

/** Reads a text answer of a stored response; anything else counts as missing. */
function text(response: Record<string, unknown>, key: string): string | null {
  const value = response[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function count(response: Record<string, unknown>, key: string): number | null {
  const value = response[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function phone(value: string | null) {
  return value ? formatPhoneNumberForDisplay(value) : 'not given';
}

/**
 * The WhatsApp alert for one lead (`demo_lead_alert`, see
 * `workflows/lead-alert/constants.ts` for its text). It reads the stored
 * response defensively, key by key, because the JSON outlives any one
 * revision of the form: a missing or retyped answer reads "not given"
 * instead of failing the alert.
 */
export function buildLeadAlertMessage(lead: { id: string; form: string; response: Record<string, unknown> }, to: string): TemplateMessage {
  const { response } = lead;
  const students = count(response, 'approxStudents');
  const staff = count(response, 'approxStaff');
  const size = [students === null ? null : `about ${students} students`, staff === null ? null : `about ${staff} staff`].filter(Boolean).join(', ');
  const contact = text(response, 'preferredContact');
  const params: Record<string, string> = {
    name: text(response, 'name') ?? 'not given',
    phone: phone(text(response, 'phone')),
    whatsapp: phone(text(response, 'whatsappNumber')),
    email: text(response, 'email') ?? 'not given',
    school: text(response, 'schoolName') ?? 'not given',
    size: size || 'not given',
    contact: contact && contact in PREFERRED_CONTACT_LABELS ? PREFERRED_CONTACT_LABELS[contact as PreferredContactMethod] : 'not given',
    reference: lead.form === DEMO_REQUEST_FORM ? lead.id : `${lead.form} ${lead.id}`,
  };
  return {
    to,
    name: LEAD_ALERT_TEMPLATE_NAME,
    languageCode: LEAD_ALERT_TEMPLATE_LANGUAGE,
    components: [
      {
        type: 'body',
        parameters: Object.entries(params).map(([parameterName, value]) => ({ type: 'text', parameter_name: parameterName, text: templateParam(value) })),
      },
    ],
  };
}
