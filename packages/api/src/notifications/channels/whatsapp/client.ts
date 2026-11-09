import { parseRetryAfter } from '../retry-after';
import type { ChannelFetch, DeliverySendOutcome } from '../types';

/**
 * Minimal WhatsApp Cloud API client (Graph API over `fetch`, no SDK): send a
 * template message and upload a document. Every call returns a classified
 * result instead of throwing for provider answers; only programming errors
 * throw. Nothing here logs request bodies (they contain phone numbers).
 */

export type WhatsAppClientConfig = {
  accessToken: string;
  phoneNumberId: string;
  /** e.g. `v24.0` (pinned in env). */
  graphApiVersion: string;
  /** Overridable for tests; production is Meta's Graph host. */
  graphBaseUrl?: string;
};

const GRAPH_BASE_URL = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 20_000;

/** A Graph API error as Meta returns it (`{ error: { code, error_subcode, … } }`). */
export type WhatsAppApiError = { status: number; code: number | null; subcode: number | null };

/**
 * Why a call got no usable answer:
 * - `connect_failed`: the connection could not be made (DNS, refused,
 *   unreachable, connect timeout, TLS), so the request never left;
 * - `outcome_unknown`: the request may have reached Meta (timeout or
 *   connection loss after sending, or a success answer without a readable
 *   body); whether it was acted on is unknown.
 */
export type WhatsAppTransportError = 'connect_failed' | 'outcome_unknown';

export type WhatsAppResult<T> = ({ ok: true } & T) | { ok: false; error: WhatsAppApiError | WhatsAppTransportError; retryAfterMs?: number };

/**
 * Node/undici error codes raised before any request byte is sent: name
 * resolution, refused or unreachable connections, the connect timeout and
 * TLS handshake failures. Anything else (a read timeout, a reset after
 * connecting) may come after Meta received the request.
 */
const PRE_SEND_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** Whether a thrown `fetch` error certainly happened before the request was sent. */
export function isPreSendError(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  // Happy eyeballs: every address failed to connect.
  if (cause instanceof AggregateError) return cause.errors.length > 0 && cause.errors.every((inner) => PRE_SEND_ERROR_CODES.has(errorCode(inner) ?? ''));
  return PRE_SEND_ERROR_CODES.has(errorCode(cause) ?? '');
}

/** A named body/header parameter of a template (templates use named parameters, D-9b). */
export type TemplateComponent =
  | { type: 'header'; parameters: Array<{ type: 'document'; document: { id: string; filename: string } }> }
  | { type: 'body'; parameters: Array<{ type: 'text'; parameter_name: string; text: string }> };

export type TemplateMessage = {
  /** E.164 with `+`; sent as digits only. */
  to: string;
  name: string;
  languageCode: string;
  components: TemplateComponent[];
};

function graphUrl(config: WhatsAppClientConfig, path: string) {
  return `${config.graphBaseUrl ?? GRAPH_BASE_URL}/${config.graphApiVersion}/${path}`;
}

async function readError(response: Response): Promise<WhatsAppApiError> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; error_subcode?: unknown } } | null;
  const code = typeof body?.error?.code === 'number' ? body.error.code : null;
  const subcode = typeof body?.error?.error_subcode === 'number' ? body.error.error_subcode : null;
  return { status: response.status, code, subcode };
}

async function call<T>(
  fetcher: ChannelFetch,
  url: string,
  init: RequestInit,
  read: (body: unknown) => T | null,
): Promise<WhatsAppResult<T>> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
  } catch (error) {
    return { ok: false, error: isPreSendError(error) ? 'connect_failed' : 'outcome_unknown' };
  }
  if (!response.ok) {
    return { ok: false, error: await readError(response), retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) };
  }
  const value = read(await response.json().catch(() => null));
  // Meta answered success but the body is unreadable: it may have acted on it.
  if (!value) return { ok: false, error: 'outcome_unknown' };
  return { ok: true, ...value };
}

/** Sends one template message; the result carries the `wamid` used by webhooks. */
export function sendTemplateMessage(config: WhatsAppClientConfig, fetcher: ChannelFetch, message: TemplateMessage) {
  return call(
    fetcher,
    graphUrl(config, `${config.phoneNumberId}/messages`),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.to.replace(/^\+/, ''),
        type: 'template',
        template: { name: message.name, language: { code: message.languageCode }, components: message.components },
      }),
    },
    (body) => {
      const id = (body as { messages?: Array<{ id?: unknown }> } | null)?.messages?.[0]?.id;
      return typeof id === 'string' && id ? { messageId: id } : null;
    },
  );
}

/**
 * Uploads a document to the number's media store (free; the ID stays valid
 * for about 30 days), so no public URL is ever needed (root AGENTS.md on
 * `/blob/*`).
 */
export function uploadMedia(
  config: WhatsAppClientConfig,
  fetcher: ChannelFetch,
  file: { bytes: Uint8Array; mimeType: string; filename: string },
) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', file.mimeType);
  form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.filename);
  return call(
    fetcher,
    graphUrl(config, `${config.phoneNumberId}/media`),
    { method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}` }, body: form },
    (body) => {
      const id = (body as { id?: unknown } | null)?.id;
      return typeof id === 'string' && id ? { mediaId: id } : null;
    },
  );
}

/**
 * Meta error codes that mean "too much, slow down" for the whole number
 * (retried with backoff, the sender pauses the channel): 4 app call limit,
 * 80007 WABA rate limit, 130429 Cloud API throughput, 131048 spam rate
 * limit (number's quality-based cap), 131057 account in maintenance.
 */
const CHANNEL_THROTTLE_CODES = new Set([4, 80007, 130429, 131048, 131057]);
/** Limits for one recipient only (retried; others continue): 131056 business/consumer pair rate limit. */
const RECIPIENT_THROTTLE_CODES = new Set([131056]);
/**
 * Temporary Meta-side failures (retried): 1 unknown, 2 service, 131000
 * something went wrong, 131016 service unavailable, 133004 server
 * temporarily unavailable.
 */
const TRANSIENT_CODES = new Set([1, 2, 131000, 131016, 133004]);
/**
 * Codes meaning the number's daily messaging limit (unique recipients in a
 * rolling 24 h) is reached, retried a day later (D-41). Empty on purpose:
 * Meta's error reference (checked 2026-11-10) names no code for reaching
 * the messaging limit tier (131064 is a limit imposed for template
 * classification violations, 131049 a per-user marketing limit), so the
 * case is handled as an ordinary transient error until Meta documents one.
 */
export const DAILY_MESSAGING_LIMIT_CODES: ReadonlySet<number> = new Set<number>();

/** Error code of a message send whose outcome is unknown (see {@link classifyWhatsAppSendFailure}). */
export const OUTCOME_UNKNOWN_ERROR_CODE = 'outcome_unknown';
export const OUTCOME_UNKNOWN_MESSAGE =
  'WhatsApp did not confirm this message; it may or may not have been sent. Check with the guardian before resending.';

/**
 * Classifies a failed call (D-7). HTTP 429 and 5xx, a failed connection and
 * the codes above are transient; everything else (invalid parameters,
 * template missing or paused, recipient not allowed, token or payment
 * problems, …) is permanent and fails the delivery with `wa_<code>` (or
 * `http_<status>`) as its error code. Used for media uploads, which change
 * nothing a person sees and are safe to repeat. Codes were taken from
 * Meta's Cloud API error reference; verify them there when Meta changes it.
 */
export function classifyWhatsAppFailure(failure: { error: WhatsAppApiError | WhatsAppTransportError; retryAfterMs?: number }): DeliverySendOutcome {
  if (failure.error === 'connect_failed' || failure.error === 'outcome_unknown') return { kind: 'retry', errorCode: 'network_error', scope: 'channel' };
  const { status, code } = failure.error;
  const errorCode = code !== null ? `wa_${code}` : `http_${status}`;
  const retry = (scope: 'recipient' | 'channel'): DeliverySendOutcome => ({ kind: 'retry', errorCode, scope, retryAfterMs: failure.retryAfterMs });
  if (code !== null && DAILY_MESSAGING_LIMIT_CODES.has(code)) return { kind: 'retry', errorCode, scope: 'recipient', limit: 'daily_messaging_limit' };
  if (code !== null && RECIPIENT_THROTTLE_CODES.has(code)) return retry('recipient');
  if (code !== null && (CHANNEL_THROTTLE_CODES.has(code) || TRANSIENT_CODES.has(code))) return retry('channel');
  if (status === 429 || status >= 500) return retry('channel');
  return { kind: 'failed', errorCode };
}

/**
 * Classifies a failed **message send** (review round 2, #2). Retrying is
 * only safe when Meta certainly did not accept the message: a connection
 * that never opened, or an explicit rejection (4xx/429 with its code). An
 * answer that leaves it open (a timeout or connection loss after sending,
 * a 5xx, a success without a message ID) is recorded `failed:
 * outcome_unknown` and never retried automatically, because a retry could
 * message the guardian twice; staff resend deliberately.
 */
export function classifyWhatsAppSendFailure(failure: { error: WhatsAppApiError | WhatsAppTransportError; retryAfterMs?: number }): DeliverySendOutcome {
  if (failure.error === 'connect_failed') return { kind: 'retry', errorCode: 'connect_failed', scope: 'channel' };
  if (failure.error === 'outcome_unknown' || failure.error.status >= 500) {
    return { kind: 'failed', errorCode: OUTCOME_UNKNOWN_ERROR_CODE, errorMessage: OUTCOME_UNKNOWN_MESSAGE, outcomeUnknown: true };
  }
  return classifyWhatsAppFailure(failure);
}
