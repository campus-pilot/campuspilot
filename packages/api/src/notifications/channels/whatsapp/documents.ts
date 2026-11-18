/**
 * The PDF hook of the WhatsApp channel (D-9). A document template (for
 * example `payment_receipt`, see `./templates.ts`) carries a PDF in its
 * header; the adapter asks the source registered for the document kind for
 * the bytes at send time, uploads them to WhatsApp media and sends the
 * media ID. No public URL is involved.
 *
 * A source is consulted twice per send: `available` decides whether the
 * message is the document template (with the PDF) or the matching text
 * template (for example `payment_received` when the school has not selected
 * a receipt template); `produce` then renders exactly the request's
 * document, scoped to the school. Sources live in `../../documents/` and
 * render through the document system.
 *
 * Results have no document kind: `results_published` is text only and
 * points to the Cadet Portal, so no report card is rendered per student.
 */

/** Which document a message needs, by identifiers only. */
export type WhatsAppDocumentRequest =
  | { kind: 'payment_receipt'; paymentId: string; sessionId: string; admissionId: string; filename: string }
  | { kind: 'bill'; billId: string; sessionId: string; admissionId: string; filename: string }
  | { kind: 'notice'; noticeId: string; filename: string }
  | {
      kind: 'timetable';
      sessionId: string;
      examSlug: string;
      /** The timetable and publication the message is about; a later publication or a withdrawal produces nothing. */
      timetableId: string;
      publicationNumber: number;
      filename: string;
    };

export type WhatsAppDocumentKind = WhatsAppDocumentRequest['kind'];
export const WHATSAPP_DOCUMENT_KINDS = ['payment_receipt', 'bill', 'notice', 'timetable'] as const satisfies readonly WhatsAppDocumentKind[];
// Every kind is listed (a kind left out would never be attachable).
const _everyKindListed: Exclude<WhatsAppDocumentKind, (typeof WHATSAPP_DOCUMENT_KINDS)[number]> extends never ? true : never = true;
void _everyKindListed;

/**
 * A produced PDF and the template revision it was rendered with (provenance).
 *
 * `shareKey` is set only for a document that is byte-for-byte the same for
 * every recipient (a notice, a timetable publication): its S3 object key,
 * which names the immutable cached PDF. The adapter then uploads it to
 * WhatsApp media once per sending phone number and reuses Meta's media ID
 * for the other recipients (`./media-cache.ts`). Per-student documents
 * (bills, receipts) never set it, so one student's PDF can never be sent to
 * another.
 */
export type NotificationDocument = { bytes: Uint8Array; mimeType: 'application/pdf'; templateRevisionId: string | null; shareKey?: string };

/**
 * `produce`'s answer when the school has no template for the kind any more
 * (deselected between `available` and `produce`). Unlike `null`, this says
 * nothing about the fact itself, so the message goes out as the matching
 * text template, exactly as if `available` had said false.
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
