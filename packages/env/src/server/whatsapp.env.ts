import { z } from 'zod';

/**
 * WhatsApp Business Cloud API (plan §3, Phase 4; D-1: one CampusPilot
 * number for every school). Read by the worker (sends) and the API server
 * (`/webhooks/whatsapp`).
 *
 * - `WHATSAPP_ENABLED` is the platform kill switch for sending (D-6).
 *   Default off, and off in local/dev unless explicitly set; while off every
 *   WhatsApp copy is recorded as `skipped: disabled`.
 * - `WHATSAPP_ACCESS_TOKEN`: a permanent System User token with
 *   `whatsapp_business_messaging` and `whatsapp_business_management`.
 * - `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID`: IDs of the
 *   sending number and its WhatsApp Business Account (WhatsApp Manager / the
 *   app's WhatsApp → API Setup page).
 * - `WHATSAPP_APP_SECRET`: the Meta app's secret (App settings → Basic);
 *   verifies webhook `X-Hub-Signature-256`.
 * - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: a random value you choose and enter in
 *   the app's webhook configuration (Meta echoes it on verification).
 * - `WHATSAPP_GRAPH_API_VERSION`: the Graph API version to call, e.g.
 *   `v24.0`; pinned explicitly so a Meta default change never alters us.
 *
 * - `WHATSAPP_SEND_RATE_PER_SECOND`: messages the sender starts per second
 *   on the one number (D-39), default 20. Meta's Cloud API allows 80 per
 *   second by default (more after upgrades); staying well below leaves room
 *   for retries and other traffic. Throttling answers (130429) still pause
 *   the channel whatever the rate.
 *
 * Everything but the switch and the rate is required only while sending is enabled
 * ({@link requireWhatsAppConfigWhenEnabled}). The webhook works whenever
 * its two secrets are set, independent of the switch, so delivery receipts
 * and STOP replies for messages already sent are still recorded.
 */
export const WHATSAPP_ENV_SHAPE = {
  WHATSAPP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d{5,30}$/, 'Use the numeric phone number ID.').optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().regex(/^\d{5,30}$/, 'Use the numeric WhatsApp Business Account ID.').optional(),
  WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(16, 'Use at least 16 random characters (e.g. openssl rand -hex 24).').optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/, 'Use a Graph API version such as v24.0.').optional(),
  WHATSAPP_SEND_RATE_PER_SECOND: z.coerce.number().int().min(1).max(1000).default(20),
};

const REQUIRED_WHEN_ENABLED = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'WHATSAPP_GRAPH_API_VERSION',
] as const;

/** Final-schema check: every WhatsApp value is required while sending is enabled. */
export function requireWhatsAppConfigWhenEnabled(
  value: { WHATSAPP_ENABLED?: boolean } & Partial<Record<(typeof REQUIRED_WHEN_ENABLED)[number], string>>,
  context: z.RefinementCtx,
) {
  if (!value.WHATSAPP_ENABLED) return;
  for (const key of REQUIRED_WHEN_ENABLED) {
    if (!value[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required while WHATSAPP_ENABLED=true.` });
  }
}
