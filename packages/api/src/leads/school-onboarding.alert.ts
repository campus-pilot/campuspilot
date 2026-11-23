import type { DatabaseExecutor } from '@campuspilot/db';
import { formatPhoneNumberForDisplay } from '@campuspilot/db/phone';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { and, eq } from 'drizzle-orm';

import type { TemplateMessage } from '../notifications/channels/whatsapp/client';
import { templateParam } from '../notifications/channels/whatsapp/templates';
import { readRequestFacts } from '../school-setup/school-setup.contract';
import { SCHOOL_ONBOARDING_ALERT_TEMPLATE_LANGUAGE, SCHOOL_ONBOARDING_ALERT_TEMPLATE_NAME } from '../workflows/lead-alert/constants';

/**
 * The WhatsApp alert of a School Onboarding submission: the message and the
 * alert state writes on `school_registration_request`. Every write is
 * conditional on the alert still being `pending`, as for leads
 * (`lead-store.ts`).
 */

export async function loadPendingOnboardingAlert(db: DatabaseExecutor, requestId: string) {
  const [request] = await db
    .select({ id: schoolRegistrationRequestTable.id, response: schoolRegistrationRequestTable.response })
    .from(schoolRegistrationRequestTable)
    .where(and(eq(schoolRegistrationRequestTable.id, requestId), eq(schoolRegistrationRequestTable.alertStatus, 'pending')))
    .limit(1);
  return request ?? null;
}

export async function markOnboardingAlertSent(db: DatabaseExecutor, requestId: string, messageId: string) {
  await db
    .update(schoolRegistrationRequestTable)
    .set({ alertStatus: 'sent', alertSentAt: new Date(), alertMessageId: messageId, alertError: null })
    .where(and(eq(schoolRegistrationRequestTable.id, requestId), eq(schoolRegistrationRequestTable.alertStatus, 'pending')));
}

/** `message` must be safe to show to platform admins: no tokens, no URLs. */
export async function markOnboardingAlertFailed(db: DatabaseExecutor, requestId: string, message: string) {
  await db
    .update(schoolRegistrationRequestTable)
    .set({ alertStatus: 'failed', alertError: message.slice(0, 500) })
    .where(and(eq(schoolRegistrationRequestTable.id, requestId), eq(schoolRegistrationRequestTable.alertStatus, 'pending')));
}

/** "9: Nursery, LKG, UKG, Class 1…": the count and the names, shortened by `templateParam`. */
function classesSummary(names: string[]) {
  return names.length === 0 ? 'not given' : `${names.length}: ${names.join(', ')}`;
}

/**
 * The `school_onboarding_alert` message for one submission (see
 * `workflows/lead-alert/constants.ts` for its text). The stored answers are
 * read defensively, so a missing answer reads "not given".
 */
export function buildOnboardingAlertMessage(request: { id: string; response: Record<string, unknown> }, to: string): TemplateMessage {
  const facts = readRequestFacts(request.response, false);
  const params: Record<string, string> = {
    school: facts.schoolName ?? 'not given',
    phone: facts.phone ? formatPhoneNumberForDisplay(facts.phone) : 'not given',
    email: facts.email ?? 'not given',
    classes: classesSummary(facts.classes.map((entry) => entry.name)),
    reference: request.id,
  };
  return {
    to,
    name: SCHOOL_ONBOARDING_ALERT_TEMPLATE_NAME,
    languageCode: SCHOOL_ONBOARDING_ALERT_TEMPLATE_LANGUAGE,
    components: [
      { type: 'body', parameters: Object.entries(params).map(([parameterName, value]) => ({ type: 'text', parameter_name: parameterName, text: templateParam(value) })) },
    ],
  };
}
