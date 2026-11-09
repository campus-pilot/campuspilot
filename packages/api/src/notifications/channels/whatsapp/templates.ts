import type { NotificationPayloads, NotificationType } from '@campuspilot/db/notifications/catalogue';

import { formatIsoDate, formatMinorAmount, formatPeriodKey } from '../format';
import type { WhatsAppDocumentRequest } from './documents';

/**
 * The WhatsApp template mapper (D-9, D-9b, D-13, D-22): every catalogue
 * type maps to one of the two generic Utility templates registered in Meta
 * (plan §6 step 9), with named parameters, or to nothing.
 *
 * - `school_update` (no header): student_name, school_name, update_text,
 *   reference.
 * - `school_document` (document/PDF header): student_name, school_name,
 *   document_name, reference.
 *
 * The exact template text lives in Meta; parameter names here must match
 * it. A document template is chosen only when its PDF can be produced
 * (D-9: attach when it costs nothing extra); otherwise the same fact goes
 * out as a `school_update` text, so a missing PDF never blocks the message.
 */

export const WHATSAPP_TEMPLATE_NAMES = ['school_update', 'school_document'] as const;
export type WhatsAppTemplateName = (typeof WHATSAPP_TEMPLATE_NAMES)[number];
/** Templates are English only (D-13); create them in Meta as "English" (`en`). */
export const WHATSAPP_TEMPLATE_LANGUAGE = 'en';

/** Named parameters per template, in template order. */
export type WhatsAppTemplateParams = {
  school_update: { student_name: string; school_name: string; update_text: string; reference: string };
  school_document: { student_name: string; school_name: string; document_name: string; reference: string };
};

export type WhatsAppMessagePlan =
  | { template: 'school_update'; params: WhatsAppTemplateParams['school_update'] }
  | { template: 'school_document'; params: WhatsAppTemplateParams['school_document']; document: WhatsAppDocumentRequest };

/** What the mapper needs besides the facts. */
export type WhatsAppMappingContext = {
  schoolName: string;
  /** Whether a document of this kind can be produced in this release. */
  canAttach: (kind: WhatsAppDocumentRequest['kind']) => boolean;
};

/** Meta's limit for one text parameter is generous; we keep values short. */
const MAX_PARAM_LENGTH = 300;

/**
 * Meta refuses parameters with new lines, tabs or more than four
 * consecutive spaces, and empty ones; values are flattened and trimmed.
 */
export function templateParam(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  const text = flat.length > MAX_PARAM_LENGTH ? `${flat.slice(0, MAX_PARAM_LENGTH - 1)}…` : flat;
  return text || '-';
}

function billUpdateText(data: NotificationPayloads['bill.issued']) {
  const amount = formatMinorAmount(data.totalAmountMinor, data.currency);
  return data.periodKey
    ? `a bill of ${amount} has been issued for ${formatPeriodKey(data.periodKey)}`
    : `a bill of ${amount} has been issued on ${formatIsoDate(data.issueDate)}`;
}

/**
 * Maps one notification to its template message; `null` means WhatsApp owes
 * nothing for the type (staff types are in-app only). Exhaustive: a new
 * type fails the build until it is mapped here.
 */
export function mapWhatsAppMessage<T extends NotificationType>(
  type: T,
  data: NotificationPayloads[T],
  context: WhatsAppMappingContext,
): WhatsAppMessagePlan | null {
  const plan = mapUnsanitized(type, data as never, context);
  if (!plan) return null;
  const params = Object.fromEntries(Object.entries(plan.params).map(([key, value]) => [key, templateParam(value)]));
  return { ...plan, params } as WhatsAppMessagePlan;
}

function mapUnsanitized(type: NotificationType, data: never, context: WhatsAppMappingContext): WhatsAppMessagePlan | null {
  switch (type) {
    case 'bill.issued': {
      const facts = data as NotificationPayloads['bill.issued'];
      return {
        template: 'school_update',
        params: { student_name: facts.studentName, school_name: context.schoolName, update_text: billUpdateText(facts), reference: facts.billNumber },
      };
    }
    case 'payment.received': {
      const facts = data as NotificationPayloads['payment.received'];
      const amount = formatMinorAmount(facts.amountMinor, facts.currency);
      if (context.canAttach('payment_receipt')) {
        return {
          template: 'school_document',
          params: { student_name: facts.studentName, school_name: context.schoolName, document_name: `payment receipt for ${amount}`, reference: facts.receiptNumber },
          document: { kind: 'payment_receipt', paymentId: facts.paymentId, sessionId: facts.sessionId, admissionId: facts.admissionId, filename: `Receipt ${facts.receiptNumber}.pdf` },
        };
      }
      return {
        template: 'school_update',
        params: { student_name: facts.studentName, school_name: context.schoolName, update_text: `a payment of ${amount} has been received`, reference: facts.receiptNumber },
      };
    }
    case 'exam.results_published': {
      const facts = data as NotificationPayloads['exam.results_published'];
      if (context.canAttach('report_card')) {
        return {
          template: 'school_document',
          params: { student_name: facts.studentName, school_name: context.schoolName, document_name: `report card for ${facts.examName}`, reference: facts.examName },
          document: { kind: 'report_card', sessionId: facts.sessionId, examSlug: facts.examSlug, admissionId: facts.admissionId, filename: `Report card ${facts.examName}.pdf` },
        };
      }
      return {
        template: 'school_update',
        params: { student_name: facts.studentName, school_name: context.schoolName, update_text: `the results of ${facts.examName} are now available`, reference: facts.examName },
      };
    }
    case 'exam.results_publish_finished':
    case 'notification.whatsapp_failed':
    case 'billing.run_posted':
      return null;
    default: {
      const unhandled: never = type;
      throw new Error(`Unmapped notification type ${String(unhandled)}.`);
    }
  }
}
