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

export type WhatsAppResult<T> = ({ ok: true } & T) | { ok: false; error: WhatsAppApiError | 'network'; retryAfterMs?: number };

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
  } catch {
    return { ok: false, error: 'network' };
  }
  if (!response.ok) {
    return { ok: false, error: await readError(response), retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) };
  }
  const value = read(await response.json().catch(() => null));
  if (!value) return { ok: false, error: { status: response.status, code: null, subcode: null } };
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
 * (retried with backoff, rest of the round deferred): 4 app call limit,
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
 * Classifies a failed call (D-7). HTTP 429 and 5xx and the codes above are
 * transient; everything else (invalid parameters, template missing or
 * paused, recipient not allowed, token or payment problems, …) is permanent
 * and fails the delivery with `wa_<code>` (or `http_<status>`) as its
 * error code. Codes were taken from Meta's Cloud API error reference; verify
 * them there when Meta changes it.
 */
export function classifyWhatsAppFailure(failure: { error: WhatsAppApiError | 'network'; retryAfterMs?: number }): DeliverySendOutcome {
  if (failure.error === 'network') return { kind: 'retry', errorCode: 'network_error', scope: 'channel' };
  const { status, code } = failure.error;
  const errorCode = code !== null ? `wa_${code}` : `http_${status}`;
  const retry = (scope: 'recipient' | 'channel'): DeliverySendOutcome => ({ kind: 'retry', errorCode, scope, retryAfterMs: failure.retryAfterMs });
  if (code !== null && RECIPIENT_THROTTLE_CODES.has(code)) return retry('recipient');
  if (code !== null && (CHANNEL_THROTTLE_CODES.has(code) || TRANSIENT_CODES.has(code))) return retry('channel');
  if (status === 429 || status >= 500) return retry('channel');
  return { kind: 'failed', errorCode };
}
