/**
 * The PDF hook of the WhatsApp channel (D-9). A `school_document` template
 * carries a PDF in its header; the adapter asks the source registered for
 * the document kind for the bytes at send time, uploads them to WhatsApp
 * media and sends the media ID. No public URL is involved.
 *
 * No source exists yet: receipts arrive with Phase 5 and per-student report
 * cards with Phase 6. Until a kind has a source, the template mapper sends
 * the same fact as a `school_update` text instead (see `./templates.ts`).
 * To add one, implement {@link WhatsAppDocumentSource} (render the PDF for
 * exactly the request's IDs, scoped to the school) and register it in
 * {@link whatsappDocumentSources}.
 */

/** Which document a message needs, by identifiers only. */
export type WhatsAppDocumentRequest =
  | { kind: 'payment_receipt'; paymentId: string; sessionId: string; admissionId: string; filename: string }
  | { kind: 'report_card'; sessionId: string; examSlug: string; admissionId: string; filename: string };

export type WhatsAppDocumentKind = WhatsAppDocumentRequest['kind'];

/** A produced PDF. */
export type NotificationDocument = { bytes: Uint8Array; mimeType: 'application/pdf' };

/**
 * Produces one document. Throwing counts as a transient failure (the send is
 * retried with backoff); return `null` when the document can never be
 * produced (the fact no longer exists), which fails the delivery.
 */
export type WhatsAppDocumentSource<K extends WhatsAppDocumentKind = WhatsAppDocumentKind> = (
  request: Extract<WhatsAppDocumentRequest, { kind: K }>,
  context: { schoolId: string },
) => Promise<NotificationDocument | null>;

export type WhatsAppDocumentSources = { [K in WhatsAppDocumentKind]: WhatsAppDocumentSource<K> | null };

/** Registered sources; `null` = not available in this release. */
export const whatsappDocumentSources: WhatsAppDocumentSources = {
  payment_receipt: null,
  report_card: null,
};
