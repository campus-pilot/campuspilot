import { db as defaultDb, type DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { notificationDeliveryTable } from '@campuspilot/db/schema/notification';
import { env } from '@campuspilot/env/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { log } from '../../../workflows/notification/log';

/**
 * `/webhooks/whatsapp` (plan §3, Phase 4): Meta's subscription check (GET)
 * and its event callbacks (POST). Public by protocol; a POST is trusted only
 * after its `X-Hub-Signature-256` HMAC over the raw body verifies with the
 * app secret. Answers 200 for every verified callback, including ones that
 * change nothing, because Meta retries non-2xx answers for days, with one
 * exception: a status receipt for a message ID no delivery carries yet,
 * dated within {@link EARLY_RECEIPT_WINDOW_MS}, is answered 503 so Meta
 * delivers it again. Meta can report a message before the worker has
 * stored the message ID it returned for the send; acknowledging that receipt
 * would lose it. Older unknown receipts (messages not sent through this
 * system, or whose send was never recorded) are acknowledged and ignored, so
 * nothing is retried for days. Inbound messages (STOP) never cause a retry.
 *
 * Enabled when `WHATSAPP_APP_SECRET` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` are
 * set, independent of `WHATSAPP_ENABLED`: receipts and STOP replies for
 * messages already sent keep being recorded after sending is switched off.
 * Without them the route answers 404.
 */

/** Meta's callbacks are small; anything larger is refused unread. */
export const WHATSAPP_WEBHOOK_MAX_BYTES = 1024 * 1024;

export type WhatsAppWebhookConfig = {
  appSecret: string;
  verifyToken: string;
  /** Only callbacks for this sending number are processed; others are acknowledged and ignored. */
  phoneNumberId: string | null;
};

export function whatsappWebhookConfigFromEnv(): WhatsAppWebhookConfig | null {
  if (!env.WHATSAPP_APP_SECRET || !env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) return null;
  return { appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? null };
}

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verifies `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(appSecret, rawBody)>`. */
export function verifyWhatsAppSignature(rawBody: Uint8Array, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = header.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return safeEqual(Buffer.from(given.toLowerCase(), 'hex'), expected);
}

/** GET: echoes `hub.challenge` when the mode and verify token match. */
export function handleWhatsAppWebhookVerification(config: WhatsAppWebhookConfig | null, query: URLSearchParams): Response {
  if (!config) return new Response('Not found', { status: 404 });
  const token = query.get('hub.verify_token') ?? '';
  const challenge = query.get('hub.challenge') ?? '';
  if (query.get('hub.mode') !== 'subscribe' || !safeEqual(Buffer.from(token), Buffer.from(config.verifyToken)) || !challenge) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  timestamp: z.string().regex(/^\d+$/).optional(),
  errors: z.array(z.object({ code: z.number().optional() }).loose()).optional(),
}).loose();

const messageSchema = z.object({
  from: z.string().min(1),
  type: z.string(),
  text: z.object({ body: z.string() }).loose().optional(),
  button: z.object({ text: z.string().optional(), payload: z.string().optional() }).loose().optional(),
}).loose();

const callbackSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).loose().optional(),
            statuses: z.array(z.unknown()).optional(),
            messages: z.array(z.unknown()).optional(),
          }).loose(),
        }).loose(),
      ),
    }).loose(),
  ),
}).loose();

export type WhatsAppStatusUpdate = {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
  errorCode: string | null;
};

/**
 * Which stored statuses a receipt may move a delivery from. Receipts only
 * ever move forward (sent → delivered → read), never back, and arrive out
 * of order and repeatedly, so each update is conditional on the current
 * status: `read` implies delivered; `failed` can only follow a send that
 * was not yet delivered.
 */
const ADVANCES_FROM: Record<WhatsAppStatusUpdate['status'], Array<'sending' | 'sent' | 'delivered'>> = {
  sent: ['sending'],
  delivered: ['sending', 'sent'],
  read: ['sending', 'sent', 'delivered'],
  failed: ['sending', 'sent'],
};

/**
 * How long after its own timestamp a receipt for an unknown message ID is
 * refused (so Meta retries it) instead of acknowledged. Covers the moment
 * between Meta accepting a send and the worker recording its message ID,
 * plus Meta's retry spacing; longer than any normal gap by far.
 */
export const EARLY_RECEIPT_WINDOW_MS = 60 * 60 * 1000;

/** What one receipt did: moved a delivery, matched one it may not move, or matched none. */
export type WhatsAppStatusResult = 'changed' | 'unchanged' | 'unknown_message';

/** Applies one receipt by `wamid`. */
export async function applyWhatsAppStatus(db: DatabaseExecutor, update: WhatsAppStatusUpdate): Promise<WhatsAppStatusResult> {
  const set =
    update.status === 'sent'
      ? { status: 'sent' as const, sentAt: update.at }
      : update.status === 'delivered'
        ? { status: 'delivered' as const, deliveredAt: update.at }
        : update.status === 'read'
          ? { status: 'read' as const, readAt: update.at, deliveredAt: sql`coalesce(${notificationDeliveryTable.deliveredAt}, ${update.at})` }
          : { status: 'failed' as const, failedAt: update.at, errorCode: update.errorCode ?? 'wa_unknown' };
  const rows = await db
    .update(notificationDeliveryTable)
    .set({ ...set, updatedAt: new Date() })
    .where(
      and(
        eq(notificationDeliveryTable.channel, 'whatsapp'),
        eq(notificationDeliveryTable.providerMessageId, update.messageId),
        inArray(notificationDeliveryTable.status, ADVANCES_FROM[update.status]),
      ),
    )
    .returning({ id: notificationDeliveryTable.id });
  if (rows.length > 0) return 'changed';
  const [known] = await db
    .select({ id: notificationDeliveryTable.id })
    .from(notificationDeliveryTable)
    .where(and(eq(notificationDeliveryTable.channel, 'whatsapp'), eq(notificationDeliveryTable.providerMessageId, update.messageId)))
    .limit(1);
  return known ? 'unchanged' : 'unknown_message';
}

/** Inbound texts that withdraw WhatsApp consent (the template footer says "Reply STOP"). */
function isStopReply(message: z.infer<typeof messageSchema>) {
  const text = message.type === 'text' ? message.text?.body : message.type === 'button' ? (message.button?.text ?? message.button?.payload) : undefined;
  return typeof text === 'string' && text.trim().toUpperCase() === 'STOP';
}

/**
 * A STOP reply withdraws consent (`admission.whatsapp_consent = false`) on
 * every admission whose WhatsApp number is the sender's, in every school:
 * the guardian replied to the one CampusPilot number (D-1) and cannot say
 * which child or school they meant, so all messages to that number stop.
 * Staff can tick consent again on the admission if the guardian asks.
 * Returns how many admissions changed.
 */
export async function withdrawWhatsAppConsent(db: DatabaseExecutor, senderDigits: string): Promise<number> {
  if (!/^\d{6,15}$/.test(senderDigits)) return 0;
  const rows = await db
    .update(admissionTable)
    .set({ whatsappConsent: false, updatedAt: new Date() })
    .where(and(eq(admissionTable.whatsappNo, `+${senderDigits}`), eq(admissionTable.whatsappConsent, true)))
    .returning({ id: admissionTable.id });
  return rows.length;
}

function toStatusUpdate(raw: unknown): WhatsAppStatusUpdate | null {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { id, status, timestamp, errors } = parsed.data;
  if (status !== 'sent' && status !== 'delivered' && status !== 'read' && status !== 'failed') return null;
  const code = errors?.[0]?.code;
  return {
    messageId: id,
    status,
    at: timestamp ? new Date(Number(timestamp) * 1000) : new Date(),
    errorCode: typeof code === 'number' ? `wa_${code}` : null,
  };
}

/** What a callback did (for logs and tests); never contains numbers or text. */
export type WhatsAppCallbackSummary = {
  statuses: number;
  statusChanges: number;
  /** Receipts for unknown message IDs recent enough to be early (see {@link EARLY_RECEIPT_WINDOW_MS}). */
  earlyReceipts: number;
  stopReplies: number;
  consentWithdrawn: number;
};

/**
 * Processes a verified callback body. Every write is conditional, so a
 * callback Meta delivers again (after an early receipt) changes nothing twice.
 */
export async function processWhatsAppCallback(
  db: DatabaseExecutor,
  config: WhatsAppWebhookConfig,
  body: unknown,
  now: Date = new Date(),
): Promise<WhatsAppCallbackSummary> {
  const summary: WhatsAppCallbackSummary = { statuses: 0, statusChanges: 0, earlyReceipts: 0, stopReplies: 0, consentWithdrawn: 0 };
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') return summary;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (config.phoneNumberId && value.metadata?.phone_number_id !== config.phoneNumberId) continue;
      for (const raw of value.statuses ?? []) {
        const update = toStatusUpdate(raw);
        if (!update) continue;
        summary.statuses += 1;
        const result = await applyWhatsAppStatus(db, update);
        if (result === 'changed') summary.statusChanges += 1;
        if (result === 'unknown_message' && now.getTime() - update.at.getTime() < EARLY_RECEIPT_WINDOW_MS) summary.earlyReceipts += 1;
      }
      for (const raw of value.messages ?? []) {
        const message = messageSchema.safeParse(raw);
        if (!message.success || !isStopReply(message.data)) continue;
        summary.stopReplies += 1;
        summary.consentWithdrawn += await withdrawWhatsAppConsent(db, message.data.from.replace(/\D/g, ''));
      }
    }
  }
  return summary;
}

/** Reads at most `limit` bytes of a body; null when it is larger. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** POST: verifies the signature over the raw body, then processes the callback. */
export async function handleWhatsAppWebhook(
  request: Request,
  config: WhatsAppWebhookConfig | null = whatsappWebhookConfigFromEnv(),
  db: DatabaseExecutor = defaultDb,
): Promise<Response> {
  if (!config) return new Response('Not found', { status: 404 });
  const raw = await readLimited(request, WHATSAPP_WEBHOOK_MAX_BYTES);
  if (!raw) return new Response('Payload too large', { status: 413 });
  if (!verifyWhatsAppSignature(raw, request.headers.get('x-hub-signature-256'), config.appSecret)) {
    log.warn({}, 'whatsapp.webhook.bad_signature');
    return new Response('Invalid signature', { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return new Response('OK', { status: 200 });
  }
  const summary = await processWhatsAppCallback(db, config, body);
  if (summary.statuses > 0 || summary.stopReplies > 0) log.info(summary, 'whatsapp.webhook.processed');
  // Not acknowledged, so Meta delivers it again once the message ID is stored.
  if (summary.earlyReceipts > 0) return new Response('Message not recorded yet', { status: 503, headers: { 'Retry-After': '60' } });
  return new Response('OK', { status: 200 });
}
