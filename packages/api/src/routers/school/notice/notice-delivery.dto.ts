import { z } from 'zod';

import { deliveryForecastSchema } from '../exam/exam-result-notification.dto';
import { NOTICE_CADET_SCOPES, NOTICE_PAGE_SIZES } from './notice.dto';

/**
 * What publishing a notice would notify (server-only schema: the forecast
 * schema reads the notification enums of the database package).
 * - `ready`: the draft can be published; `staffRecipientCount` is the school
 *   members who get the in-app notification (0 when not addressed to staff)
 *   and `cadetForecast` the students addressed with, per remote channel, the
 *   copies owed and skipped by reason (null when not addressed to students).
 * - `already_published`: nobody is notified again.
 */
export const noticePublishPreviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ready'),
    /** The notice version this forecast was made for; publish with it as `expectedVersion` only if it is the version reviewed. */
    version: z.number().int().positive(),
    /**
     * The school Notice template revision the notice would be printed with
     * if it were published now (null = built-in design, or the notice is its
     * own template); publish with it as `expectedTemplateRevisionId` only if
     * it is the revision of the preview that was reviewed.
     */
    templateRevisionId: z.string().nullable(),
    /**
     * The paper the notice will be printed on (its `pageSize`). Part of the
     * notice's content, so `version` already covers it.
     */
    pageSize: z.enum(NOTICE_PAGE_SIZES),
    toStaff: z.boolean(),
    staffRecipientCount: z.number().int().nonnegative(),
    cadetScope: z.enum(NOTICE_CADET_SCOPES),
    cadetForecast: deliveryForecastSchema.nullable(),
  }),
  z.object({ kind: z.literal('already_published'), publishedAt: z.date() }),
]);
export type NoticePublishPreview = z.infer<typeof noticePublishPreviewSchema>;
