import { schoolTierCatalogue } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { formatIstShortDate } from '@/lib/trial-dates';

/** The school's standing tier (it never lapses), by its catalogue label; nothing without one. */
export function SchoolSubscriptionBadge({ subscribedTier }: Pick<SchoolDto, 'subscribedTier'>) {
  return subscribedTier ? <Badge variant="secondary">{schoolTierCatalogue[subscribedTier].label}</Badge> : null;
}

/** What each kind of billing period is called on a badge. */
const PERIOD_KIND_LABELS = { trial: 'Trial', paid: 'Paid', complimentary: 'Free' } as const;

/** The active billing period, with its kind, tier and the day it ends: "Trial · Pro · ends 17 Dec". */
export function SchoolPeriodBadge({ period }: Pick<SchoolDto, 'period'>) {
  if (!period) return null;
  return (
    <Badge variant="outline">
      {PERIOD_KIND_LABELS[period.kind]} · {schoolTierCatalogue[period.tier].label} · ends {formatIstShortDate(period.endsAt)}
    </Badge>
  );
}

/**
 * Shown while the school has no plan (no standing tier and no active period),
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
 * is named: demo, a personal space, its standing tier, its active billing period, no plan, and
 * suspended. Each is its own fact on the school and its own badge; none is
 * derived from another.
 */
export function SchoolBadges({
  school,
}: {
  school: Pick<SchoolDto, 'isDemo' | 'kind' | 'subscribedTier' | 'planTier' | 'period' | 'suspendedAt'>;
}) {
  return (
    <>
      {school.isDemo ? <Badge variant="outline">Demo</Badge> : null}
      {/* A person's personal space (docs/personal-space.md): its own fact, `kind`. */}
      {school.kind === 'personal' ? <Badge variant="outline">Personal</Badge> : null}
      <SchoolSubscriptionBadge subscribedTier={school.subscribedTier} />
      <SchoolPeriodBadge period={school.period} />
      <SchoolNoPlanBadge planTier={school.planTier} />
      <SchoolSuspendedBadge suspendedAt={school.suspendedAt} />
    </>
  );
}
