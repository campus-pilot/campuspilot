import { db as defaultDb, type Database } from '@campuspilot/db';
import { financeBillTable, financeLedgerEntryTable } from '@campuspilot/db/schema/finance';
import { and, eq } from 'drizzle-orm';

import { documentSourceSchema } from '../../routers/school/document/document.dto';
import { selectedDocumentTemplateTypes } from '../../routers/school/document/document.selected-template';
import { buildFinanceDocumentContexts } from '../../routers/school/document/finance-document.context';
import type { WhatsAppDocumentSource } from '../channels/whatsapp/documents';
import { renderNotificationDocument } from './render';

/**
 * The bill attached to a `bill.issued` WhatsApp message (D-9): exactly the
 * bill `generateDocument` would produce for this one bill with the school's
 * selected bill template. Every bill differs, so each student's PDF is
 * rendered for their own message and never shared (no `shareKey`).
 *
 * The bill must be posted, belong to the notification's admission and
 * session, and not have been reversed: a bill reversal keeps the bill row
 * (`posted`) and appends an opposite ledger fact whose `reversal_of_entry_id`
 * is the bill's ledger entry, so the source checks for that fact itself
 * (the document system's bill contexts do not, because staff may still
 * print a reversed bill). A reversed or missing bill never produces a
 * valid-looking PDF: the delivery fails with `document_unavailable`.
 */
export function createBillDocumentSource(db: Database = defaultDb): WhatsAppDocumentSource<'bill'> {
  return {
    available: async ({ schoolId }) => (await selectedDocumentTemplateTypes(db, schoolId, ['bill'])).has('bill'),
    produce: (request, { schoolId }) =>
      renderNotificationDocument(
        {
          schoolId,
          documentType: 'bill',
          buildContexts: async (database) => {
            const source = documentSourceSchema.parse({ documentType: 'bill', sessionId: request.sessionId, billIds: [request.billId] });
            if (source.documentType !== 'bill') return [];
            return database.transaction(
              async (tx) => {
                const [bill] = await tx
                  .select({ ledgerEntryId: financeBillTable.ledgerEntryId })
                  .from(financeBillTable)
                  .where(and(eq(financeBillTable.schoolId, schoolId), eq(financeBillTable.id, request.billId)))
                  .limit(1);
                if (!bill) return [];
                const [reversal] = await tx
                  .select({ id: financeLedgerEntryTable.id })
                  .from(financeLedgerEntryTable)
                  .where(and(eq(financeLedgerEntryTable.schoolId, schoolId), eq(financeLedgerEntryTable.reversalOfEntryId, bill.ledgerEntryId)))
                  .limit(1);
                if (reversal) return [];
                const data = await buildFinanceDocumentContexts(tx, schoolId, source);
                if (data.financeSource.kind !== 'bill' || data.financeSource.admissionIds.join() !== request.admissionId) return [];
                return data.contexts;
              },
              { isolationLevel: 'repeatable read', accessMode: 'read only' },
            );
          },
        },
        db,
      ),
  };
}
