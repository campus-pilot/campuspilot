import { db as defaultDb, type Database } from '@campuspilot/db';
import { ORPCError } from '@orpc/server';

import { combineDocuments, convertDocumentPdf, renderDocument } from '../../routers/school/document/document.render';
import { getSelectedDocumentTemplate } from '../../routers/school/document/document.selected-template';
import type { DocumentType } from '../../routers/school/document/document.dto';
import { DOCUMENT_TEMPLATE_UNAVAILABLE, type NotificationDocument } from '../channels/whatsapp/documents';

/**
 * Renders one notification attachment through the document system
 * (docs/document-system.md), with the same pieces and rules as
 * `generateDocument`: the school's selected immutable template revision,
 * the document type's own context builder (finance documents from
 * posting-time snapshots), the restricted Handlebars renderer, sanitising,
 * batch layout and Gotenberg conversion. Nothing is persisted: the PDF is
 * an attachment of one message, not a document in the school's history;
 * the template revision used is returned so the delivery records its
 * provenance.
 *
 * No selected template (deselected after the channel checked availability)
 * gives {@link DOCUMENT_TEMPLATE_UNAVAILABLE}: the channel sends the text
 * message instead. A domain refusal of the context builder or renderer (a
 * 4xx `ORPCError`: the fact is gone, a payment was reversed, results are
 * not approved, the template is invalid) means this document can never be
 * produced: `null`.
 * Anything else (database, S3, Gotenberg unavailable) is thrown, which the
 * channel treats as transient and retries.
 */
export async function renderNotificationDocument(
  input: {
    schoolId: string;
    documentType: DocumentType;
    buildContexts: (db: Database) => Promise<object[]>;
  },
  db: Database = defaultDb,
): Promise<NotificationDocument | typeof DOCUMENT_TEMPLATE_UNAVAILABLE | null> {
  let template: Awaited<ReturnType<typeof getSelectedDocumentTemplate>>;
  try {
    template = await getSelectedDocumentTemplate(db, { schoolId: input.schoolId, documentType: input.documentType });
  } catch (error) {
    if (error instanceof ORPCError && error.status === 404) return DOCUMENT_TEMPLATE_UNAVAILABLE;
    throw error;
  }
  try {
    const contexts = await input.buildContexts(db);
    if (contexts.length !== 1) return null;
    const html = combineDocuments(contexts.map((context) => renderDocument(template.content, context)), input.documentType, template.row.pageSize);
    const bytes = await convertDocumentPdf(html, input.documentType);
    return { bytes: new Uint8Array(bytes), mimeType: 'application/pdf', templateRevisionId: template.row.id };
  } catch (error) {
    if (error instanceof ORPCError && error.status >= 400 && error.status < 500) return null;
    throw error;
  }
}
