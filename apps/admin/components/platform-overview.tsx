'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { PlatformStatsDto } from '@campuspilot/api/routers/system-admin/stats/stats.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import {
  ArrowRight,
  Building2,
  FlaskConical,
  GraduationCap,
  KeyRound,
  Users,
} from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { SchoolAvatar } from './school-avatar';
import {
  StatsError,
  StatTile,
  StatTileGridSkeleton,
  formatCount,
} from './stat-tile';

const RECENT_SCHOOL_LIMIT = 5;

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

function PlatformStatTiles({ stats }: { stats: PlatformStatsDto }) {
  const pendingSchools = stats.schools.total - stats.schools.onboarded;
  const activeClients = stats.oauthClients.total - stats.oauthClients.disabled;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Organizations"
        value={stats.schools.total}
        hint={`${formatCount(stats.schools.onboarded)} onboarded · ${formatCount(pendingSchools)} setup pending`}
        icon={Building2}
      />
      <StatTile
        label="Demo schools"
        value={stats.schools.demo}
        hint="Provisioned sandbox schools"
        icon={FlaskConical}
      />
      <StatTile
        label="OAuth clients"
        value={stats.oauthClients.total}
        hint={`${formatCount(activeClients)} active · ${formatCount(stats.oauthClients.disabled)} disabled`}
        icon={KeyRound}
      />
      <StatTile
        label="Staff members"
        value={stats.staffMembers}
        hint="Users with a school membership"
        icon={Users}
      />
      <StatTile
        label="Registered students"
        value={stats.registeredAdmissions}
        hint="Registered admissions across schools"
        icon={GraduationCap}
      />
      {/* TODO: add a demo request tile once the demo request feature exists. */}
    </div>
  );
}

function PlatformStats() {
  const statsQuery = useQuery(orpc.systemAdmin.getPlatformStats.queryOptions());

  if (statsQuery.isPending) return <StatTileGridSkeleton count={5} />;
  if (statsQuery.isError) {
    return (
      <StatsError
        title="Platform statistics unavailable"
        onRetry={() => void statsQuery.refetch()}
      />
    );
  }
  return <PlatformStatTiles stats={statsQuery.data} />;
}

function RecentSchoolList() {
  const schoolsQuery = useQuery(
    orpc.systemAdmin.listSchools.queryOptions({
      input: {
        limit: RECENT_SCHOOL_LIMIT,
        orderBy: { field: 'createdAt', direction: 'desc' },
      },
    }),
  );

  if (schoolsQuery.isPending) return <Skeleton className="h-48 rounded-lg" />;
  if (schoolsQuery.isError) {
    return <p className="text-sm text-muted-foreground">Schools could not be loaded.</p>;
  }
  if (schoolsQuery.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No organizations have been added yet.</p>;
  }

  return (
    <ul className="flex flex-col divide-y">
      {schoolsQuery.data.items.map((school) => (
        <li key={school.id}>
          <Link
            href={`/school/${school.id}`}
            className="flex items-center gap-2.5 py-2 hover:bg-muted/50"
          >
            <SchoolAvatar school={school} size="sm" />
            <span className="min-w-0 flex-1 truncate font-medium">{school.name}</span>
            {school.isDemo ? <Badge variant="outline">Demo</Badge> : null}
            <span className="shrink-0 text-muted-foreground">
              {school.createdAt ? dateFormatter.format(school.createdAt) : '—'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentSchoolsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recently added organizations</CardTitle>
        <CardDescription>The newest schools on CampusPilot.</CardDescription>
        <CardAction>
          <Button asChild type="button" variant="ghost" size="sm">
            <Link href="/organizations">
              View all <ArrowRight aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <RecentSchoolList />
      </CardContent>
    </Card>
  );
}

/** Platform-wide home for administrators: aggregate counts and new schools. */
export function PlatformOverview() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <p className="text-sm text-muted-foreground">
          An overview of organizations and integrations across CampusPilot.
        </p>
      </div>
      <PlatformStats />
      <RecentSchoolsCard />
    </section>
  );
}
