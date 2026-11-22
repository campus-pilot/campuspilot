'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SchoolStatsDto } from '@campuspilot/api/routers/system-admin/stats/stats.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { CalendarDays, LayoutGrid, Rows3, Users } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { SchoolAvatar } from './school-avatar';
import { SchoolBadges } from './school-badges';
import {
  ClassEnrolmentCard,
  SchoolStatsBoundary,
  StudentMetricTiles,
  sessionLabel,
} from './school-stats';
import { PersonalSpaceOverview } from './personal-space-overview';
import { StatTile, StatTileGridSkeleton, StatsError, formatCount } from './stat-tile';

function SchoolHeader({ schoolId }: { schoolId: string }) {
  const schoolQuery = useQuery(
    orpc.systemAdmin.getSchool.queryOptions({ input: { id: schoolId } }),
  );

  if (schoolQuery.isPending) return <Skeleton className="h-12 w-72 rounded-lg" />;
  if (schoolQuery.isError) {
    return <h1 className="text-2xl font-semibold tracking-tight">School dashboard</h1>;
  }

  const school = schoolQuery.data;
  return (
    <div className="flex items-center gap-3">
      <SchoolAvatar school={school} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{school.name}</h1>
          <SchoolBadges school={school} />
          {/* A personal space has no guided setup, so onboarding says nothing about it. */}
          {school.kind === 'personal' ? null : (
            <Badge variant={school.hasCompletedOnboarding ? 'secondary' : 'outline'}>
              {school.hasCompletedOnboarding ? 'Onboarded' : 'Setup pending'}
            </Badge>
          )}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {/* No separator before the slug when there is no location (a personal space has none). */}
          {[school.location, school.slug].filter((part) => part !== '').join(' · ')}
        </p>
      </div>
    </div>
  );
}

function SchoolStructureTiles({ stats }: { stats: SchoolStatsDto }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label="Staff members" value={stats.staffMembers} icon={Users} />
      <StatTile label="Classes" value={stats.classes} icon={LayoutGrid} />
      <StatTile
        label="Sections"
        value={stats.sections}
        hint={`Across ${formatCount(stats.classes)} classes`}
        icon={Rows3}
      />
      <StatTile
        label="Sessions"
        value={stats.sessions}
        hint={
          stats.activeSession
            ? `Active: ${sessionLabel(stats.activeSession)}`
            : 'No active session'
        }
        icon={CalendarDays}
      />
    </div>
  );
}

function SchoolOverviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** The dashboard's body for the school's kind: a personal space's own figures, or a school's counts. */
function SchoolOverviewBody({ schoolId }: { schoolId: string }) {
  const schoolQuery = useQuery(orpc.systemAdmin.getSchool.queryOptions({ input: { id: schoolId } }));
  if (schoolQuery.isPending) return <StatTileGridSkeleton count={8} />;
  if (schoolQuery.isError) return <StatsError title="School" onRetry={() => void schoolQuery.refetch()} />;
  if (schoolQuery.data.kind === 'personal') return <PersonalSpaceOverview school={schoolQuery.data} />;
  return <SchoolCounts schoolId={schoolId} />;
}

/** A school's aggregate counts: its structure and its students. */
function SchoolCounts({ schoolId }: { schoolId: string }) {
  return (
    <SchoolStatsBoundary schoolId={schoolId} skeletonTiles={8}>
      {(stats) => (
        <>
          <SchoolOverviewSection title="School">
            <SchoolStructureTiles stats={stats} />
          </SchoolOverviewSection>
          <SchoolOverviewSection title="Students">
            <StudentMetricTiles stats={stats} />
            <ClassEnrolmentCard stats={stats} />
          </SchoolOverviewSection>
        </>
      )}
    </SchoolStatsBoundary>
  );
}

/** School dashboard for platform admins: identity plus the figures that fit its kind. */
export function SchoolOverview({ schoolId }: { schoolId: string }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <SchoolHeader schoolId={schoolId} />
      <SchoolOverviewBody schoolId={schoolId} />
    </div>
  );
}
