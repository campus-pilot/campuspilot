import { db as defaultDb, type Database } from '@campuspilot/db';

import { documentSourceSchema } from '../../routers/school/document/document.dto';
import { selectedDocumentTemplateTypes } from '../../routers/school/document/document.selected-template';
import { buildFinanceDocumentContexts } from '../../routers/school/document/finance-document.context';
import type { WhatsAppDocumentSource } from '../channels/whatsapp/documents';
import { renderNotificationDocument } from './render';

/**
 * The payment receipt attached to a `payment.received` WhatsApp message
 * (D-9): exactly the receipt `generateDocument` would produce for this one
 * payment with the school's selected receipt template. The source uses the
 * `posted_unreversed_payments` policy, so a payment reversed before the
 * message went out never produces a valid-looking receipt (the delivery
 * fails with `document_unavailable` instead). The payment must belong to
 * the notification's admission and session.
 */
export function createReceiptDocumentSource(db: Database = defaultDb): WhatsAppDocumentSource<'payment_receipt'> {
  return {
    available: async ({ schoolId }) => (await selectedDocumentTemplateTypes(db, schoolId, ['receipt'])).has('receipt'),
    produce: (request, { schoolId }) =>
      renderNotificationDocument(
        {
          schoolId,
          documentType: 'receipt',
          buildContexts: async (database) => {
            const source = documentSourceSchema.parse({
              documentType: 'receipt',
              sessionId: request.sessionId,
              transactions: [{ kind: 'payment', id: request.paymentId }],
              selectionPolicy: 'posted_unreversed_payments',
            });
            if (source.documentType !== 'receipt') return [];
            const data = await database.transaction((tx) => buildFinanceDocumentContexts(tx, schoolId, source), {
              isolationLevel: 'repeatable read',
              accessMode: 'read only',
            });
            if (data.financeSource.kind !== 'receipt' || data.financeSource.admissionIds.join() !== request.admissionId) return [];
            return data.contexts;
          },
        },
        db,
      ),
  };
}
