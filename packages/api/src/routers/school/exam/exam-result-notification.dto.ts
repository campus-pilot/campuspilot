import { REMOTE_NOTIFICATION_CHANNELS } from '@campuspilot/db/notifications/catalogue';
import { notificationSkipReasonEnum } from '@campuspilot/db/schema/notification';
import { z } from 'zod';

import { examScopeSchema, examStudentScopeSchema } from './exam.dto';

const count = z.number().int().nonnegative();

/** Copies owed and skips by reason for one remote channel (D-26). */
export const channelForecastSchema = z.object({
  owed: count,
  skipped: z.partialRecord(z.enum(notificationSkipReasonEnum.enumValues), count),
});

/**
 * What a result send decides when staff press the button (or release): the students
 * addressed and, per remote channel, the copies owed and the skips by
 * reason. Web push counts one copy per active device subscription; WhatsApp
 * one per student. The in-app inbox always gets one row per student.
 */
export const deliveryForecastSchema = z.object({
  recipientCount: count,
  channels: z.object(
    Object.fromEntries(REMOTE_NOTIFICATION_CHANNELS.map((channel) => [channel, channelForecastSchema])) as Record<
      (typeof REMOTE_NOTIFICATION_CHANNELS)[number],
      typeof channelForecastSchema
    >,
  ),
});

/** Settled WhatsApp outcome per student, recorded when every delivery settled. */
export const resultPublicationOutcomeSchema = z.object({
  recipientCount: count,
  sentCount: count,
  failedCount: count,
  skippedCount: count,
});

export const resultPublicationSchema = z.object({
  id: z.string(),
  examName: z.string(),
  publishedAt: z.date(),
  publishedBy: z.string().nullable(),
  snapshot: deliveryForecastSchema,
  finishedAt: z.date().nullable(),
  outcome: resultPublicationOutcomeSchema.nullable(),
});

export const examResultPublicationInputSchema = examScopeSchema;

/** What releasing an examination to the Cadet Portal would notify (D-43). */
export const resultReleasePreviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first_release'), forecast: deliveryForecastSchema }),
  z.object({ kind: z.literal('already_notified'), notifiedAt: z.date() }),
]);

export const studentResultNotificationInputSchema = examStudentScopeSchema;

export const sendStudentResultNotificationInputSchema = examStudentScopeSchema.extend({
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Unique per press; resend the same key to retry safely. A new key sends the result again.'),
});
