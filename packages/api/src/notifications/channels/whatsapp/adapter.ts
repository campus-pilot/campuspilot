import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { schoolTable } from '@campuspilot/db/schema/school';
import { env } from '@campuspilot/env/server';
import { eq } from 'drizzle-orm';

import { log } from '../../../workflows/notification/log';
import type {
  ChannelFetch,
  ClaimedDelivery,
  DeliveryDecision,
  DeliverySendOutcome,
  NotificationChannelAdapter,
  ResolvedRecipient,
} from '../types';
import {
  classifyWhatsAppFailure,
  classifyWhatsAppSendFailure,
  sendTemplateMessage,
  uploadMedia,
  type TemplateComponent,
  type WhatsAppClientConfig,
} from './client';
import { whatsappDocumentSources } from './document-sources';
import { DOCUMENT_TEMPLATE_UNAVAILABLE, WHATSAPP_DOCUMENT_KINDS, type NotificationDocument, type WhatsAppDocumentKind, type WhatsAppDocumentRequest, type WhatsAppDocumentSources } from './documents';
import { mapWhatsAppMessage, WHATSAPP_TEMPLATE_LANGUAGE, type WhatsAppMessagePlan } from './templates';

/**
 * Whether WhatsApp may be sent to an admission (D-4, D-8), first failing
 * check wins: a WhatsApp number must exist, staff must have verified it,
 * and the guardian must have consented (a STOP reply withdraws consent).
 * Checked at fan-out ({@link decideWhatsApp}) and again right before the
 * provider call, because a STOP or an edit may land in between.
 */
export function whatsappEligibility(admission: { whatsappNo: string | null; whatsappVerified: boolean; whatsappConsent: boolean }) {
  if (!admission.whatsappNo) return { ok: false as const, reason: 'no_number' as const };
  if (!admission.whatsappVerified) return { ok: false as const, reason: 'not_verified' as const };
  if (!admission.whatsappConsent) return { ok: false as const, reason: 'no_consent' as const };
  return { ok: true as const, number: admission.whatsappNo };
}

/** One copy to the admission's WhatsApp number, or a skip with the reason. */
export function decideWhatsApp(recipient: ResolvedRecipient): DeliveryDecision[] {
  if (recipient.kind !== 'admission') return [];
  const eligibility = whatsappEligibility(recipient);
  if (!eligibility.ok) return [{ status: 'skipped', reason: eligibility.reason, destination: null }];
  return [{ status: 'owed', destination: eligibility.number }];
}

/** A filename Meta and every phone accept (no path separators or control characters). */
function safeFilename(name: string) {
  return name.replace(/[^\w .()-]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document.pdf';
}

function bodyComponent(plan: WhatsAppMessagePlan): TemplateComponent {
  return {
    type: 'body',
    parameters: Object.entries(plan.params).map(([name, text]) => ({ type: 'text' as const, parameter_name: name, text })),
  };
}

/**
 * WhatsApp sender (Cloud API). Per claimed delivery: re-check eligibility
 * against the live admission, map the template, produce and upload the PDF
 * when the template has a document header, then send. Upload answers are
 * classified by `classifyWhatsAppFailure` (safe to repeat), the message
 * send's by `classifyWhatsAppSendFailure`, which never retries a send that
 * may have gone out (D-7, review round 2 #2).
 */
export function createWhatsAppAdapter(options: {
  config: WhatsAppClientConfig;
  fetch?: ChannelFetch;
  db?: DatabaseExecutor;
  documentSources?: WhatsAppDocumentSources;
}): NotificationChannelAdapter {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const db = options.db ?? defaultDb;
  const sources = options.documentSources ?? whatsappDocumentSources;

  /** The PDF of a request; null when its kind has no source or the fact is gone. */
  async function produceDocument(request: WhatsAppDocumentRequest, schoolId: string) {
    switch (request.kind) {
      case 'payment_receipt':
        return sources.payment_receipt ? sources.payment_receipt.produce(request, { schoolId }) : null;
      case 'report_card':
        return sources.report_card ? sources.report_card.produce(request, { schoolId }) : null;
      default: {
        const unhandled: never = request;
        throw new Error(`Unhandled document kind ${JSON.stringify(unhandled)}.`);
      }
    }
  }

  /** Kinds the school can attach now (a source exists and says it is available). */
  async function attachableKinds(schoolId: string) {
    const kinds = new Set<WhatsAppDocumentKind>();
    for (const kind of WHATSAPP_DOCUMENT_KINDS) {
      const source = sources[kind];
      if (source && (await source.available({ schoolId }))) kinds.add(kind);
    }
    return kinds;
  }

  async function send(delivery: ClaimedDelivery): Promise<DeliverySendOutcome> {
    if (!delivery.destination || !delivery.admissionId) return { kind: 'failed', errorCode: 'no_destination', definiteAnswer: false };
    const [admission] = await db
      .select({
        whatsappNo: admissionTable.whatsappNo,
        whatsappVerified: admissionTable.whatsappVerified,
        whatsappConsent: admissionTable.whatsappConsent,
        schoolName: schoolTable.name,
      })
      .from(admissionTable)
      .innerJoin(schoolTable, eq(schoolTable.id, admissionTable.schoolId))
      .where(eq(admissionTable.id, delivery.admissionId))
      .limit(1);
    if (!admission) return { kind: 'failed', errorCode: 'admission_gone', definiteAnswer: false };
    const eligibility = whatsappEligibility(admission);
    if (!eligibility.ok) return { kind: 'skipped', reason: eligibility.reason };
    // The number staff entered changed after the fan-out: never message the old one.
    if (eligibility.number !== delivery.destination) return { kind: 'failed', errorCode: 'number_changed', definiteAnswer: false };

    let attachable: Set<WhatsAppDocumentKind>;
    try {
      attachable = await attachableKinds(delivery.schoolId);
    } catch {
      return { kind: 'retry', errorCode: 'document_error', scope: 'recipient', definiteAnswer: false };
    }
    const mapMessage = () => mapWhatsAppMessage(delivery.type, delivery.data as never, {
      schoolName: admission.schoolName,
      canAttach: (kind) => attachable.has(kind),
    });
    let plan = mapMessage();
    if (!plan) return { kind: 'failed', errorCode: 'no_template', definiteAnswer: false };

    let document: NotificationDocument | null = null;
    if (plan.template === 'school_document') {
      let produced: Awaited<ReturnType<typeof produceDocument>>;
      try {
        produced = await produceDocument(plan.document, delivery.schoolId);
      } catch {
        return { kind: 'retry', errorCode: 'document_error', scope: 'recipient', definiteAnswer: false };
      }
      if (produced === DOCUMENT_TEMPLATE_UNAVAILABLE) {
        // The school deselected the template since availability was checked:
        // send the same fact as text, as if it had never been available.
        attachable.delete(plan.document.kind);
        plan = mapMessage();
        if (!plan) return { kind: 'failed', errorCode: 'no_template', definiteAnswer: false };
      } else if (!produced) {
        return { kind: 'failed', errorCode: 'document_unavailable', definiteAnswer: false };
      } else {
        document = produced;
      }
    }

    const components: TemplateComponent[] = [];
    if (plan.template === 'school_document' && document) {
      const filename = safeFilename(plan.document.filename);
      const upload = await uploadMedia(options.config, fetcher, { bytes: document.bytes, mimeType: document.mimeType, filename });
      if (!upload.ok) return classifyWhatsAppFailure(upload);
      components.push({ type: 'header', parameters: [{ type: 'document', document: { id: upload.mediaId, filename } }] });
    }
    components.push(bodyComponent(plan));

    const sent = await sendTemplateMessage(options.config, fetcher, {
      to: delivery.destination,
      name: plan.template,
      languageCode: WHATSAPP_TEMPLATE_LANGUAGE,
      components,
    });
    if (!sent.ok) return classifyWhatsAppSendFailure(sent);
    return { kind: 'sent', providerMessageId: sent.messageId, documentTemplateRevisionId: document?.templateRevisionId ?? null };
  }

  return { channel: 'whatsapp', available: true, decide: decideWhatsApp, send };
}

/** The platform's WhatsApp adapter: unavailable unless `WHATSAPP_ENABLED=true`. */
export function createWhatsAppAdapterFromEnv(): NotificationChannelAdapter {
  if (!env.WHATSAPP_ENABLED || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_GRAPH_API_VERSION) {
    return { channel: 'whatsapp', available: false, unavailableReason: 'WhatsApp is switched off (WHATSAPP_ENABLED).' };
  }
  // Logged once at start-up, so a stack pointed at a mock of the Cloud API is visible.
  log.info({ graphBaseUrl: env.WHATSAPP_GRAPH_BASE_URL, graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION }, 'notification.whatsapp.graph');
  return createWhatsAppAdapter({
    config: {
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
      graphBaseUrl: env.WHATSAPP_GRAPH_BASE_URL,
    },
  });
}
