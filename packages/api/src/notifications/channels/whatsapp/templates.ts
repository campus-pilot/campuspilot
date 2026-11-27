import type { NotificationPayloads, NotificationType } from '@campuspilot/db/notifications/catalogue';

import { formatIsoDate, formatMinorAmount } from '../format';
import type { WhatsAppDocumentRequest } from './documents';

/**
 * The WhatsApp template mapper (D-9, D-9b, D-13, D-22): every student
 * catalogue type maps to its own fixed-wording Utility template registered
 * in Meta, with named parameters, or to nothing (staff types).
 *
 * Each type has a specific template rather than one generic template with a
 * free-text slot: Meta classifies a template whose content it cannot read
 * from the wording as Marketing, which costs several times as much and is
 * capped per user. Pairs of a text template and a document (PDF header)
 * template:
 * - `bill_issued` / `bill_document`: student_name, school_name,
 *   bill_number, issue_date, amount.
 * - `payment_received` / `payment_receipt`: student_name, school_name,
 *   amount, receipt_number.
 * - `notice_published` / `notice_document`: student_name, school_name,
 *   notice_title.
 * - `timetable_published` / `timetable_document`: student_name,
 *   school_name, exam_name.
 * - `results_published` (text only, points to the Cadet Portal):
 *   student_name, school_name, exam_name.
 *
 * The exact template text lives in Meta; template and parameter names here
 * must match it. A document template is chosen only when its PDF can be
 * produced (D-9: attach when it costs nothing extra); otherwise the same
 * fact goes out as the matching text template, so a missing PDF never
 * blocks the message.
 */

export const WHATSAPP_TEXT_TEMPLATE_NAMES = ['bill_issued', 'payment_received', 'results_published', 'notice_published', 'timetable_published'] as const;
export const WHATSAPP_DOCUMENT_TEMPLATE_NAMES = ['bill_document', 'payment_receipt', 'notice_document', 'timetable_document'] as const;
export const WHATSAPP_TEMPLATE_NAMES = [...WHATSAPP_TEXT_TEMPLATE_NAMES, ...WHATSAPP_DOCUMENT_TEMPLATE_NAMES] as const;
export type WhatsAppTextTemplateName = (typeof WHATSAPP_TEXT_TEMPLATE_NAMES)[number];
export type WhatsAppDocumentTemplateName = (typeof WHATSAPP_DOCUMENT_TEMPLATE_NAMES)[number];
export type WhatsAppTemplateName = (typeof WHATSAPP_TEMPLATE_NAMES)[number];
/** Templates are English only (D-13); create them in Meta as "English" (`en`). */
export const WHATSAPP_TEMPLATE_LANGUAGE = 'en';

type BillParams = { student_name: string; school_name: string; bill_number: string; issue_date: string; amount: string };
type PaymentParams = { student_name: string; school_name: string; amount: string; receipt_number: string };
type NoticeParams = { student_name: string; school_name: string; notice_title: string };
type ExamParams = { student_name: string; school_name: string; exam_name: string };

/** Named parameters per template, in template order. */
export type WhatsAppTemplateParams = {
  bill_issued: BillParams;
  bill_document: BillParams;
  payment_received: PaymentParams;
  payment_receipt: PaymentParams;
  results_published: ExamParams;
  notice_published: NoticeParams;
  notice_document: NoticeParams;
  timetable_published: ExamParams;
  timetable_document: ExamParams;
};

export type WhatsAppMessagePlan =
  | { [N in WhatsAppTextTemplateName]: { template: N; params: WhatsAppTemplateParams[N] } }[WhatsAppTextTemplateName]
  | {
      [N in WhatsAppDocumentTemplateName]: { template: N; params: WhatsAppTemplateParams[N]; document: WhatsAppDocumentRequest };
    }[WhatsAppDocumentTemplateName];

/** What the mapper needs besides the facts. */
export type WhatsAppMappingContext = {
  schoolName: string;
  /** Whether a document of this kind can be produced for this school now. */
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
      const params = {
        student_name: facts.studentName,
        school_name: context.schoolName,
        bill_number: facts.billNumber,
        issue_date: formatIsoDate(facts.issueDate),
        amount: formatMinorAmount(facts.totalAmountMinor, facts.currency),
      };
      if (context.canAttach('bill')) {
        return {
          template: 'bill_document',
          params,
          document: { kind: 'bill', billId: facts.billId, sessionId: facts.sessionId, admissionId: facts.admissionId, filename: `Bill ${facts.billNumber}.pdf` },
        };
      }
      return { template: 'bill_issued', params };
    }
    case 'payment.received': {
      const facts = data as NotificationPayloads['payment.received'];
      const params = {
        student_name: facts.studentName,
        school_name: context.schoolName,
        amount: formatMinorAmount(facts.amountMinor, facts.currency),
        receipt_number: facts.receiptNumber,
      };
      if (context.canAttach('payment_receipt')) {
        return {
          template: 'payment_receipt',
          params,
          document: { kind: 'payment_receipt', paymentId: facts.paymentId, sessionId: facts.sessionId, admissionId: facts.admissionId, filename: `Receipt ${facts.receiptNumber}.pdf` },
        };
      }
      return { template: 'payment_received', params };
    }
    case 'exam.results_published': {
      // Text only: the template points to the Cadet Portal, where the
      // student reads their results; no report card is attached.
      const facts = data as NotificationPayloads['exam.results_published'];
      return { template: 'results_published', params: { student_name: facts.studentName, school_name: context.schoolName, exam_name: facts.examName } };
    }
    case 'notice.published': {
      const facts = data as NotificationPayloads['notice.published'];
      const params = { student_name: facts.studentName, school_name: context.schoolName, notice_title: facts.noticeTitle };
      if (context.canAttach('notice')) {
        return { template: 'notice_document', params, document: { kind: 'notice', noticeId: facts.noticeId, filename: `Notice ${facts.noticeTitle}.pdf` } };
      }
      return { template: 'notice_published', params };
    }
    case 'exam.timetable_published': {
      const facts = data as NotificationPayloads['exam.timetable_published'];
      const params = { student_name: facts.studentName, school_name: context.schoolName, exam_name: facts.examName };
      // An event queued before the publication was recorded on it cannot
      // name the PDF of its own publication, so it goes out as text.
      if (facts.timetableId !== undefined && facts.publicationNumber !== undefined && context.canAttach('timetable')) {
        return {
          template: 'timetable_document',
          params,
          document: {
            kind: 'timetable',
            sessionId: facts.sessionId,
            examSlug: facts.examSlug,
            timetableId: facts.timetableId,
            publicationNumber: facts.publicationNumber,
            filename: `Timetable ${facts.examName}.pdf`,
          },
        };
      }
      return { template: 'timetable_published', params };
    }
    case 'notice.published_staff':
    case 'exam.timetable_published_staff':
    case 'exam.results_publish_finished':
    case 'notification.whatsapp_failed':
    case 'notification.whatsapp_batch_failed':
    case 'billing.run_posted':
      return null;
    default: {
      const unhandled: never = type;
      throw new Error(`Unmapped notification type ${String(unhandled)}.`);
    }
  }
}
