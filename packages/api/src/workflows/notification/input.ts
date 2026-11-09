import { z } from 'zod';

import { MAX_NOTIFICATION_DISPATCH_ATTEMPTS } from './constants';

/** Input of `NotificationControl.dispatch` and the `NotificationDispatch` workflow; parsed before any journal entry. */
export const notificationDispatchInputSchema = z.object({
  eventId: z.string().regex(/^nev_[a-z0-9]{21}$/),
  /** The event's `dispatch_attempt` this hand-over is for; absent means 1. */
  attempt: z.number().int().min(1).max(MAX_NOTIFICATION_DISPATCH_ATTEMPTS).default(1),
});

export type NotificationDispatchInput = z.input<typeof notificationDispatchInputSchema>;
