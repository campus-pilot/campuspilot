import { schoolTierCatalogue } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { formatIstShortDate } from '@/lib/trial-dates';

/** The tier the school subscribes to, by its catalogue label; nothing without a subscription. */
export function SchoolSubscriptionBadge({ subscribedTier }: Pick<SchoolDto, 'subscribedTier'>) {
  return subscribedTier ? <Badge variant="secondary">{schoolTierCatalogue[subscribedTier].label}</Badge> : null;
}

/** The active trial, with its tier and the day it ends: "Trial · Pro · ends 17 Dec". */
export function SchoolTrialBadge({ trial }: Pick<SchoolDto, 'trial'>) {
  if (!trial) return null;
  return (
    <Badge variant="outline">
      Trial · {schoolTierCatalogue[trial.tier].label} · ends {formatIstShortDate(trial.endsAt)}
    </Badge>
  );
}

/**
 * Shown while the school has no plan (no subscription and no active trial),
 * which makes it read-only for its staff and students.
 */
export function SchoolNoPlanBadge({ planTier }: Pick<SchoolDto, 'planTier'>) {
  if (planTier !== null) return null;
  return (
    <Badge variant="outline" className="border-warning/60 bg-warning/15 text-warning-foreground">
      No plan
    </Badge>
  );
}

/** Shown only while the school is suspended (`suspendedAt` set), so it is read-only for its staff and students. */
export function SchoolSuspendedBadge({ suspendedAt }: Pick<SchoolDto, 'suspendedAt'>) {
  return suspendedAt ? <Badge variant="destructive">Suspended</Badge> : null;
}

/**
 * The facts about a school an administrator should see wherever the school
 * is named: demo, its subscription, its active trial, no plan, and
 * suspended. Each is its own fact on the school and its own badge; none is
 * derived from another.
 */
export function SchoolBadges({
  school,
}: {
  school: Pick<SchoolDto, 'isDemo' | 'subscribedTier' | 'planTier' | 'trial' | 'suspendedAt'>;
}) {
  return (
    <>
      {school.isDemo ? <Badge variant="outline">Demo</Badge> : null}
      <SchoolSubscriptionBadge subscribedTier={school.subscribedTier} />
      <SchoolTrialBadge trial={school.trial} />
      <SchoolNoPlanBadge planTier={school.planTier} />
      <SchoolSuspendedBadge suspendedAt={school.suspendedAt} />
    </>
  );
}
