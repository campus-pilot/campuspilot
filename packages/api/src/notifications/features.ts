import type { DatabaseExecutor } from '@campuspilot/db';
import type { SchoolFeatureKey } from '@campuspilot/db/feature-flags/catalogue';
import { notificationRequiredFeatures, type NotificationType } from '@campuspilot/db/notifications/catalogue';

import { isSchoolFeatureEnabled } from '../feature-flags/feature-flags.service';

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
 * A type without required features costs no query.
 */
export async function disabledFeatureOf(db: DatabaseExecutor, schoolId: string, type: NotificationType): Promise<SchoolFeatureKey | null> {
  for (const feature of notificationRequiredFeatures[type]) {
    if (!(await isSchoolFeatureEnabled(db, schoolId, feature))) return feature;
  }
  return null;
}
