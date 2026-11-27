import { createBillDocumentSource } from '../../documents/bill';
import { createNoticeDocumentSource } from '../../documents/notice';
import { createReceiptDocumentSource } from '../../documents/receipt';
import { createTimetableDocumentSource } from '../../documents/timetable';
import type { WhatsAppDocumentSources } from './documents';

/**
 * The platform's registered document sources (kept apart from
 * `./documents.ts` so the hook's types do not import the document system).
 */
export const whatsappDocumentSources: WhatsAppDocumentSources = {
  payment_receipt: createReceiptDocumentSource(),
  bill: createBillDocumentSource(),
  notice: createNoticeDocumentSource(),
  timetable: createTimetableDocumentSource(),
};
