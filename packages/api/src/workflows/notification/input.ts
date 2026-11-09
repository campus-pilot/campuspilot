import { z } from 'zod';

/** Input of `NotificationControl.dispatch` and the `NotificationDispatch` workflow; parsed before any journal entry. */
export const notificationDispatchInputSchema = z.object({
  eventId: z.string().regex(/^nev_[a-z0-9]{21}$/),
});

export type NotificationDispatchInput = z.infer<typeof notificationDispatchInputSchema>;
