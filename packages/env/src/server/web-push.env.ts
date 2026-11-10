import { z } from 'zod';

/** `true`/`false` env flag; anything else is refused. */
const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/**
 * Web push from the installed Cadet Portal (plan §3b, D-33). Read by the API
 * server and the worker (which sends).
 *
 * - `WEB_PUSH_ENABLED` is the platform kill switch. Default off, and off in
 *   local/dev unless explicitly set; while off every push copy is recorded
 *   as `skipped: disabled`.
 * - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are the application server key
 *   pair (base64url, `npx web-push generate-vapid-keys`). The public key is
 *   also the Cadet Portal's `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; both must be the
 *   same value, or push services refuse the sends.
 * - `VAPID_SUBJECT` is the contact push services may use about abuse:
 *   a `mailto:` or `https:` URL.
 * - `WEB_PUSH_SEND_RATE_PER_SECOND`: pushes each sender lane starts per
 *   second (D-39; four lanes sharded by school), default 50. Push services
 *   limit per subscription, so this only keeps the worker's own load even.
 * The keys and subject are required only while push is enabled
 * ({@link requireWebPushConfigWhenEnabled}).
 */
export const WEB_PUSH_ENV_SHAPE = {
  WEB_PUSH_ENABLED: flag,
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/, 'Use the base64url public key from `npx web-push generate-vapid-keys`.').optional(),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/, 'Use the base64url private key from `npx web-push generate-vapid-keys`.').optional(),
  VAPID_SUBJECT: z
    .string()
    .refine((value) => value.startsWith('mailto:') || value.startsWith('https://'), 'Use a mailto: or https: URL.')
    .optional(),
  WEB_PUSH_SEND_RATE_PER_SECOND: z.coerce.number().int().min(1).max(1000).default(50),
};

/** Final-schema check: the VAPID values are required while web push is enabled. */
export function requireWebPushConfigWhenEnabled(
  value: { WEB_PUSH_ENABLED?: boolean; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string },
  context: z.RefinementCtx,
) {
  if (!value.WEB_PUSH_ENABLED) return;
  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const) {
    if (!value[key]) {
      context.addIssue({ code: 'custom', path: [key], message: `${key} is required while WEB_PUSH_ENABLED=true.` });
    }
  }
}
