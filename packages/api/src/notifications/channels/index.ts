import type { RemoteNotificationChannel } from '@campuspilot/db/notifications/catalogue';

import type { DeliveryDecision, NotificationChannelAdapter, ResolvedRecipient } from './types';
import { createWebPushAdapterFromEnv } from './web-push/adapter';
import { createWhatsAppAdapterFromEnv } from './whatsapp/adapter';

export type * from './types';

/**
 * The adapter of every remote channel, built once from the platform
 * environment. Exhaustive by type: a new remote channel fails the build
 * until it has an adapter. Each channel is behind its own kill switch
 * (`WEB_PUSH_ENABLED`, `WHATSAPP_ENABLED`; default off, off locally); a
 * switched-off channel is `available: false`, so its copies are recorded as
 * `skipped: disabled`. Built at module load: a switch changes with a
 * restart. The dispatch workflow journals its plan, so a replay after such a
 * restart keeps the recorded plan, and a planned send whose channel has since
 * been switched off is recorded `skipped: disabled` at send time.
 */
export const notificationChannelAdapters: Record<RemoteNotificationChannel, NotificationChannelAdapter> = {
  web_push: createWebPushAdapterFromEnv(),
  whatsapp: createWhatsAppAdapterFromEnv(),
};

/**
 * Decides a recipient's copies on one channel. Precedence, first match wins:
 * 1. the channel is unavailable on this platform → `skipped: disabled`;
 * 2. the school is a demo school → `skipped: demo_school` (demos never send
 *    outside the inbox);
 * 3. the channel's own decision for the recipient (number, verification,
 *    consent, subscriptions, opt-out).
 */
export function decideDeliveries(
  adapter: NotificationChannelAdapter,
  context: { isDemoSchool: boolean; recipient: ResolvedRecipient },
): DeliveryDecision[] {
  if (!adapter.available) return [{ status: 'skipped', reason: 'disabled', destination: null }];
  if (context.isDemoSchool) return [{ status: 'skipped', reason: 'demo_school', destination: null }];
  return adapter.decide(context.recipient);
}
