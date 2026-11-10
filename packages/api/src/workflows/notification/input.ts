import { z } from 'zod';
import { REMOTE_NOTIFICATION_CHANNELS } from '@campuspilot/db/notifications/catalogue';

import { MAX_NOTIFICATION_DISPATCH_ATTEMPTS } from './constants';

/** Input of `NotificationControl.dispatch` and the `NotificationDispatch` workflow; parsed before any journal entry. */
export const notificationDispatchInputSchema = z.object({
  eventId: z.string().regex(/^nev_[a-z0-9]{21}$/),
  /** The event's `dispatch_attempt` this hand-over is for; absent means 1. */
  attempt: z.number().int().min(1).max(MAX_NOTIFICATION_DISPATCH_ATTEMPTS).default(1),
});

export type NotificationDispatchInput = z.input<typeof notificationDispatchInputSchema>;

/** Input of `NotificationControl.poke`: the sender lane to start draining (D-39). */
export const notificationSenderPokeInputSchema = z.object({
  channel: z.enum(REMOTE_NOTIFICATION_CHANNELS),
  lane: z.number().int().min(0).max(999),
});

export type NotificationSenderPokeInput = z.infer<typeof notificationSenderPokeInputSchema>;
