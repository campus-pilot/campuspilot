'use client';

import type { LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import type { PersonalSpaceStatsDto } from '@campuspilot/api/routers/system-admin/stats/stats.dto';
import { Card, CardContent } from '@campuspilot/ui/components/card';
import { CalendarClock, Files, HardDrive, Layers, Sparkles } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { StatTile, StatTileGridSkeleton, StatsError } from './stat-tile';

const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/** Bytes as the largest binary unit that keeps the number at least 1 (`1.4 GB`), one decimal. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** A headline that is not a count (a size, an amount, a date), with an optional supporting line. */
function ValueTile({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: LucideIcon }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}

/** The space's plan: its trial (or other period) and when it ends, or that it has none (read-only). */
function planTileOf(school: SchoolDto): { value: string; hint: string } {
  if (school.period) {
    const kind = school.period.kind === 'trial' ? 'Trial' : school.period.kind === 'paid' ? 'Paid' : 'Complimentary';
    return { value: kind, hint: `Until ${dateFormatter.format(school.period.endsAt)}` };
  }
  if (school.planTier) return { value: 'Standing tier', hint: 'No end date' };
  return { value: 'Ended', hint: 'Read-only: no active plan' };
}

function aiSpendHint(stats: PersonalSpaceStatsDto): string {
  const limit = !stats.aiSpend.settingsValid
    ? 'limit unknown (settings not valid)'
    : stats.aiSpend.monthlyLimitUsd === null
      ? 'no limit'
      : `of ${usdFormatter.format(stats.aiSpend.monthlyLimitUsd)}`;
  return `${limit}, until ${dateFormatter.format(stats.aiSpend.windowEnd)}`;
}

function PersonalSpaceTiles({ school, stats }: { school: SchoolDto; stats: PersonalSpaceStatsDto }) {
  const plan = planTileOf(school);
  const usedShare = Math.round((stats.storedBytes / stats.storageQuotaBytes) * 100);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatTile label="Question papers" value={stats.papers} icon={Files} />
      <StatTile label="Versions" value={stats.versions} icon={Layers} />
      <ValueTile
        label="Storage used"
        value={formatBytes(stats.storedBytes)}
        hint={`${usedShare}% of ${formatBytes(stats.storageQuotaBytes)}`}
        icon={HardDrive}
      />
      <ValueTile label="AI spend this window" value={usdFormatter.format(Number(stats.aiSpend.spentUsd))} hint={aiSpendHint(stats)} icon={Sparkles} />
      <ValueTile label="Plan" value={plan.value} hint={plan.hint} icon={CalendarClock} />
    </div>
  );
}

/**
 * A personal space's dashboard for platform admins (docs/personal-space.md):
 * what matters for one person's papers (papers, versions, storage against the
 * quota, AI spend in the window, the plan), never the school counts (staff,
 * classes, sessions, students), which a personal space does not have.
 */
export function PersonalSpaceOverview({ school }: { school: SchoolDto }) {
  const statsQuery = useQuery(orpc.systemAdmin.getPersonalSpaceStats.queryOptions({ input: { schoolId: school.id } }));
  if (statsQuery.isPending) return <StatTileGridSkeleton count={5} />;
  if (statsQuery.isError) return <StatsError title="Personal space" onRetry={() => void statsQuery.refetch()} />;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">Personal space</h2>
      <PersonalSpaceTiles school={school} stats={statsQuery.data} />
    </section>
  );
}
