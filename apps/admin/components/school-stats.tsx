'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SchoolStatsDto } from '@campuspilot/api/routers/system-admin/stats/stats.dto';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';
import { Progress } from '@campuspilot/ui/components/progress';
import { GraduationCap, UserCheck, UserMinus, UserX } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import {
  StatsError,
  StatTile,
  StatTileGridSkeleton,
  formatCount,
} from './stat-tile';

type ActiveSessionStats = NonNullable<SchoolStatsDto['activeSession']>;

export function sessionLabel(session: Pick<ActiveSessionStats, 'sessionStartYear' | 'sessionEndYear'>) {
  return `${session.sessionStartYear}–${session.sessionEndYear}`;
}

/**
 * Loads aggregate school counts and renders loading/error states, handing
 * the data to `children` only once it is available.
 */
export function SchoolStatsBoundary({
  schoolId,
  skeletonTiles,
  children,
}: {
  schoolId: string;
  skeletonTiles: number;
  children: (stats: SchoolStatsDto) => ReactNode;
}) {
  const statsQuery = useQuery(
    orpc.systemAdmin.getSchoolStats.queryOptions({ input: { schoolId } }),
  );

  if (statsQuery.isPending) return <StatTileGridSkeleton count={skeletonTiles} />;
  if (statsQuery.isError) {
    return (
      <StatsError
        title="School statistics unavailable"
        onRetry={() => void statsQuery.refetch()}
      />
    );
  }
  return children(statsQuery.data);
}

/** Admission and enrolment counts; never individual student records. */
export function StudentMetricTiles({ stats }: { stats: SchoolStatsDto }) {
  const session = stats.activeSession;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Registered students"
        value={stats.admissions.registered}
        hint={`${formatCount(stats.admissions.total)} admissions in total`}
        icon={UserCheck}
      />
      <StatTile
        label="Unregistered students"
        value={stats.admissions.unregistered}
        hint="Admissions that left the school"
        icon={UserX}
      />
      <StatTile
        label="Enrolled this session"
        value={session?.enrolledStudents ?? 0}
        hint={session ? `Active session ${sessionLabel(session)}` : 'No active session'}
        icon={GraduationCap}
      />
      <StatTile
        label="Without a class"
        value={session?.studentsWithoutClass ?? 0}
        hint={session ? 'Enrolled but not placed in a class' : 'No active session'}
        icon={UserMinus}
      />
    </div>
  );
}

function ClassEnrolmentRow({
  label,
  students,
  total,
}: {
  label: string;
  students: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((students / total) * 100) : 0;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatCount(students)}
        </span>
      </div>
      <Progress value={percent} aria-label={`${label}: ${percent}% of enrolled students`} />
    </li>
  );
}

function ClassEnrolmentList({ session }: { session: ActiveSessionStats }) {
  if (session.studentsByClass.length === 0) {
    return <p className="text-sm text-muted-foreground">This school has no classes yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {session.studentsByClass.map((row) => (
        <ClassEnrolmentRow
          key={row.classId}
          label={row.label}
          students={row.students}
          total={session.enrolledStudents}
        />
      ))}
    </ul>
  );
}

/** Enrolment per class in the active session. */
export function ClassEnrolmentCard({ stats }: { stats: SchoolStatsDto }) {
  const session = stats.activeSession;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enrolment by class</CardTitle>
        <CardDescription>
          {session
            ? `Registered students in the ${sessionLabel(session)} session.`
            : 'Activate a session to see enrolment by class.'}
        </CardDescription>
      </CardHeader>
      {session ? (
        <CardContent>
          <ClassEnrolmentList session={session} />
        </CardContent>
      ) : null}
    </Card>
  );
}
