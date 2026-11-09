/**
 * The PDF hook of the WhatsApp channel (D-9). A `school_document` template
 * carries a PDF in its header; the adapter asks the source registered for
 * the document kind for the bytes at send time, uploads them to WhatsApp
 * media and sends the media ID. No public URL is involved.
 *
 * A source is consulted twice per send: `available` decides whether the
 * message is a `school_document` (with the PDF) or the same fact as a
 * `school_update` text (for example when the school has not selected a
 * receipt template, see `./templates.ts`); `produce` then renders exactly
 * the request's document, scoped to the school. Sources live in
 * `../../documents/` and render through the document system.
 */

/** Which document a message needs, by identifiers only. */
export type WhatsAppDocumentRequest =
  | { kind: 'payment_receipt'; paymentId: string; sessionId: string; admissionId: string; filename: string }
  | { kind: 'report_card'; sessionId: string; examSlug: string; admissionId: string; filename: string };

export type WhatsAppDocumentKind = WhatsAppDocumentRequest['kind'];
export const WHATSAPP_DOCUMENT_KINDS = ['payment_receipt', 'report_card'] as const satisfies readonly WhatsAppDocumentKind[];

/** A produced PDF and the template revision it was rendered with (provenance). */
export type NotificationDocument = { bytes: Uint8Array; mimeType: 'application/pdf'; templateRevisionId: string | null };

/**
 * `produce`'s answer when the school has no template for the kind any more
 * (deselected between `available` and `produce`). Unlike `null`, this says
 * nothing about the fact itself, so the message goes out as the text
 * `school_update`, exactly as if `available` had said false.
 */
export const DOCUMENT_TEMPLATE_UNAVAILABLE = 'template_unavailable' as const;

/**
 * Produces one kind of document.
 * - `available`: whether the school can produce this kind at all right now
 *   (for example it has selected a template). False sends text instead.
 * - `produce`: throwing counts as a transient failure (the send is retried
 *   with backoff); `null` means this document can never be produced (the
 *   fact is gone or was reversed), which fails the delivery;
 *   {@link DOCUMENT_TEMPLATE_UNAVAILABLE} sends the text instead.
 */
export type WhatsAppDocumentSource<K extends WhatsAppDocumentKind = WhatsAppDocumentKind> = {
  available: (context: { schoolId: string }) => Promise<boolean>;
  produce: (
    request: Extract<WhatsAppDocumentRequest, { kind: K }>,
    context: { schoolId: string },
  ) => Promise<NotificationDocument | typeof DOCUMENT_TEMPLATE_UNAVAILABLE | null>;
};

/** One source per kind; `null` = not available in this release. */
export type WhatsAppDocumentSources = { [K in WhatsAppDocumentKind]: WhatsAppDocumentSource<K> | null };
