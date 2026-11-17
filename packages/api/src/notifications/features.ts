import type { DatabaseExecutor } from '@campuspilot/db';
import type { SchoolFeatureKey } from '@campuspilot/db/feature-flags/catalogue';
import {
  notificationChannelRequiredFeatures,
  notificationRequiredFeatures,
  REMOTE_NOTIFICATION_CHANNELS,
  type NotificationType,
  type RemoteNotificationChannel,
} from '@campuspilot/db/notifications/catalogue';
import { schoolTable } from '@campuspilot/db/schema/school';
import { eq } from 'drizzle-orm';

import { rpcError } from '../errors';
import { getSchoolFeatureFlags, isSchoolFeatureEnabled } from '../feature-flags/feature-flags.service';

/**
 * The first platform feature `type` needs that the school does not have
 * (catalogue order), or null when the type needs none or has them all.
 *
 * One answer for every point where a notification could still leave the
 * API after its feature was switched off, so they cannot drift apart:
 * - the fan-out plans the type's remote copies as `skipped:
 *   feature_disabled` (`loadDispatchableEvent`, `decideDeliveries`);
 * - the sender skips an owed copy the same way just before sending
 *   (`sendDelivery`), which covers copies queued before the switch;
 * - a staff resend is refused with the disabled-feature error;
 * - the notice PDF source produces nothing.
 * A type without required features costs no query; most types name student
 * management, so most cost one small read of the school's flags.
 *
 * A **channel** can need a feature of its own, whatever the type
 * ({@link disabledChannelFeatureOf}); the same points ask both.
 */
export async function disabledFeatureOf(db: DatabaseExecutor, schoolId: string, type: NotificationType): Promise<SchoolFeatureKey | null> {
  for (const feature of notificationRequiredFeatures[type]) {
    if (!(await isSchoolFeatureEnabled(db, schoolId, feature))) return feature;
  }
  return null;
}

/**
 * The first platform feature the remote `channel` needs that the school
 * does not have (`notificationChannelRequiredFeatures`), or null when the
 * channel needs none or the school has them all. Today: WhatsApp needs the
 * school's `whatsapp` feature. A channel without required features costs no
 * query.
 */
export async function disabledChannelFeatureOf(
  db: DatabaseExecutor,
  schoolId: string,
  channel: RemoteNotificationChannel,
): Promise<SchoolFeatureKey | null> {
  for (const feature of notificationChannelRequiredFeatures[channel]) {
    if (!(await isSchoolFeatureEnabled(db, schoolId, feature))) return feature;
  }
  return null;
}

/**
 * The remote channels the school cannot send on because it lacks a feature
 * the channel needs, from one read of the school's features. Journaled with
 * a dispatched event and used by the forecast, so both decide a channel the
 * same way.
 */
export async function channelsWithoutFeature(db: DatabaseExecutor, schoolId: string): Promise<RemoteNotificationChannel[]> {
  const features = await getSchoolFeatureFlags(db, schoolId);
  return REMOTE_NOTIFICATION_CHANNELS.filter((channel) =>
    notificationChannelRequiredFeatures[channel].some((feature) => !features[feature].active),
  );
}

/**
 * What a school is for the channel decision (`decideDeliveries`), each its
 * own fact: whether it is a demo school (which never sends outside the
 * inbox) and which remote channels it lacks the feature for.
 */
export type SchoolDeliveryFacts = {
  isDemoSchool: boolean;
  channelsWithoutFeature: RemoteNotificationChannel[];
};

/** {@link SchoolDeliveryFacts} of a school, for a forecast. NOT_FOUND when the school does not exist. */
export async function schoolDeliveryFacts(db: DatabaseExecutor, schoolId: string): Promise<SchoolDeliveryFacts> {
  const [school] = await db.select({ isDemo: schoolTable.isDemo }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (!school) throw rpcError.notFound('School');
  return { isDemoSchool: school.isDemo, channelsWithoutFeature: await channelsWithoutFeature(db, schoolId) };
}
