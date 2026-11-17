import {
  schoolTierCatalogue,
  type SchoolTier,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import { Badge } from '@campuspilot/ui/components/badge';

/** The school's subscription tier, by its catalogue label, or "No plan" when it has none. */
export function SchoolTierBadge({ tier }: { tier: SchoolTier | null }) {
  return <Badge variant="secondary">{tier === null ? 'No plan' : schoolTierCatalogue[tier].label}</Badge>;
}

/** Shown only while the school is suspended (`suspendedAt` set), so it is read-only for its staff and students. */
export function SchoolSuspendedBadge({ suspendedAt }: Pick<SchoolDto, 'suspendedAt'>) {
  return suspendedAt ? <Badge variant="destructive">Suspended</Badge> : null;
}

/**
 * The facts about a school an administrator should see wherever the school
 * is named: demo, its tier, and suspended. Each is its own fact on the
 * school and its own badge; none is derived from another.
 */
export function SchoolBadges({ school }: { school: Pick<SchoolDto, 'isDemo' | 'tier' | 'suspendedAt'> }) {
  return (
    <>
      {school.isDemo ? <Badge variant="outline">Demo</Badge> : null}
      <SchoolTierBadge tier={school.tier} />
      <SchoolSuspendedBadge suspendedAt={school.suspendedAt} />
    </>
  );
}
