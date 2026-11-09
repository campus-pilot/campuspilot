import Link from 'next/link';
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CalendarCheckIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  HourglassIcon,
  LockIcon,
  MessageSquareQuoteIcon,
} from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@campuspilot/ui/components/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@campuspilot/ui/components/item';
import { Progress } from '@campuspilot/ui/components/progress';
import { Badge } from '@campuspilot/ui/components/reui/badge';
import { IconTile } from '@campuspilot/ui/components/reui/icon-tile';
import { cn } from '@campuspilot/ui/lib/utils';

import { ScreenHeader, SectionLabel } from './concept-shell';
import { type Exam, type ExamStatus, type SubjectResult, exams, student } from './mock-data';

const statusCopy: Record<ExamStatus, { label: string; variant: 'success-light' | 'warning-light' | 'info-light' | 'outline' }> = {
  released: { label: 'Released', variant: 'success-light' },
  awaiting_release: { label: 'Awaiting release', variant: 'warning-light' },
  in_progress: { label: 'In progress', variant: 'info-light' },
  upcoming: { label: 'Upcoming', variant: 'outline' },
};

/** Released exams show their score; every other state says why there is nothing to see yet. */
function ExamRow({ exam }: { exam: Exam }) {
  const { label, variant } = statusCopy[exam.status];
  const opens = exam.status !== 'upcoming';
  const body = (
    <>
      <ItemContent>
        <ItemTitle>{exam.name}</ItemTitle>
        <ItemDescription>{exam.window}</ItemDescription>
      </ItemContent>
      <ItemActions className="flex-col items-end gap-1">
        {exam.percentage !== null ? (
          <span className="text-sm font-semibold tabular-nums">
            {exam.percentage}% · {exam.grade}
          </span>
        ) : null}
        <Badge variant={variant} radius="full">
          {label}
        </Badge>
      </ItemActions>
      {opens ? <ChevronRightIcon className="size-4 text-muted-foreground" /> : null}
    </>
  );
  return opens ? (
    <Item asChild className="rounded-none border-b border-b-border last:border-b-0">
      <Link href={`/concept/results/${exam.slug}`}>{body}</Link>
    </Item>
  ) : (
    <Item className="rounded-none border-b border-b-border opacity-70 last:border-b-0">{body}</Item>
  );
}

export function ResultsScreen() {
  return (
    <>
      <ScreenHeader title="Results" description={`Session ${student.session}`} />
      <ItemGroup className="gap-0 rounded-lg border">
        {exams.map((exam) => (
          <ExamRow key={exam.slug} exam={exam} />
        ))}
      </ItemGroup>
      <p className="text-xs text-muted-foreground">
        Results appear here only after your school releases them to the Cadet Portal. Earlier sessions are in Growth.
      </p>
    </>
  );
}

/** Overall score, grade and attendance — the three things guardians ask about first. */
function ResultSummary({ exam }: { exam: Exam }) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="grid grid-cols-3 divide-x p-0 text-center">
        <div className="flex flex-col gap-0.5 py-4">
          <span className="text-2xl font-semibold tabular-nums">{exam.percentage}%</span>
          <span className="text-xs text-muted-foreground">Overall</span>
        </div>
        <div className="flex flex-col gap-0.5 py-4">
          <span className="text-2xl font-semibold">{exam.grade}</span>
          <span className="text-xs text-muted-foreground">Grade</span>
        </div>
        <div className="flex flex-col gap-0.5 py-4">
          <span className="text-2xl font-semibold tabular-nums">
            {exam.attendance ? Math.round((exam.attendance.present / exam.attendance.total) * 100) : '—'}%
          </span>
          <span className="text-xs text-muted-foreground">
            {exam.attendance ? `${exam.attendance.present}/${exam.attendance.total} days` : 'Attendance'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function TeacherRemark({ remark }: { remark: NonNullable<Exam['remark']> }) {
  return (
    <Card className="gap-3 border-violet-500/20 bg-violet-500/5 py-4">
      <CardHeader className="flex flex-row items-center gap-2.5 px-4">
        <IconTile variant="soft" size="sm" className="text-violet-600">
          <MessageSquareQuoteIcon />
        </IconTile>
        <div className="flex flex-col">
          <CardTitle className="text-sm">{remark.teacher}</CardTitle>
          <span className="text-xs text-muted-foreground">{remark.role}</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 text-sm leading-relaxed">“{remark.text}”</CardContent>
    </Card>
  );
}

/** Change against the same student's previous exam; never against classmates. */
function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null) return null;
  const diff = now - before;
  const up = diff >= 0;
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', up ? 'text-emerald-600' : 'text-rose-600')}>
      <Icon className="size-3.5" />
      {Math.abs(diff)}
    </span>
  );
}

function SubjectRow({ result }: { result: SubjectResult }) {
  const share = (result.obtained / result.max) * 100;
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">{result.subject}</span>
        <Delta now={Math.round(share)} before={result.previous} />
        <span className="w-14 text-right text-sm font-semibold tabular-nums">
          {result.obtained}/{result.max}
        </span>
        <Badge variant="outline" className="w-7 justify-center">
          {result.grade}
        </Badge>
      </div>
      <Progress value={share} className="h-1.5" />
      <div className="flex gap-3 text-xs text-muted-foreground tabular-nums">
        {result.modes.map((mode) => (
          <span key={mode.label}>
            {mode.label} {mode.obtained}/{mode.max}
          </span>
        ))}
      </div>
    </div>
  );
}

function SubjectList({ subjects }: { subjects: SubjectResult[] }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel action={<span className="text-xs text-muted-foreground">vs Unit Test 1</span>}>Subjects</SectionLabel>
      <div className="rounded-lg border">
        {subjects.map((result) => (
          <SubjectRow key={result.subject} result={result} />
        ))}
      </div>
    </section>
  );
}

function CoScholastic({ areas }: { areas: Exam['coScholastic'] }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Activities</SectionLabel>
      <div className="grid grid-cols-3 gap-2">
        {areas.map((area) => (
          <div key={area.area} className="flex flex-col gap-1 rounded-lg border p-3">
            <span className="text-lg font-semibold">{area.grade}</span>
            <span className="text-xs leading-tight text-muted-foreground">{area.area}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ResultDetailScreen({ exam }: { exam: Exam }) {
  return (
    <>
      <ScreenHeader
        title={exam.name}
        description={`Released ${exam.releasedToCadetAt} · ${exam.session}`}
        action={
          <Button variant="outline" size="icon-lg" aria-label="Download report card">
            <DownloadIcon />
          </Button>
        }
      />
      <ResultSummary exam={exam} />
      {exam.remark ? <TeacherRemark remark={exam.remark} /> : null}
      <SubjectList subjects={exam.subjects} />
      <CoScholastic areas={exam.coScholastic} />
      <Button asChild variant="outline" size="lg" className="w-full">
        <Link href="/concept/growth">See growth across exams</Link>
      </Button>
    </>
  );
}

/** Exam finished but the school has not released it: say so plainly, with no partial marks. */
export function AwaitingReleaseScreen({ exam }: { exam: Exam }) {
  return (
    <>
      <ScreenHeader title={exam.name} description={exam.window} />
      <Empty className="flex-none border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HourglassIcon />
          </EmptyMedia>
          <EmptyTitle>Results not released yet</EmptyTitle>
          <EmptyDescription>
            Teachers are still checking and approving marks. We’ll notify you the moment {student.school} releases them.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex flex-col gap-2 text-left text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2"><CalendarCheckIcon className="size-4" />Exam held {exam.window}</span>
          <span className="inline-flex items-center gap-2"><ClockIcon className="size-4" />Marking in progress</span>
          <span className="inline-flex items-center gap-2"><LockIcon className="size-4" />Visible after school release</span>
        </EmptyContent>
      </Empty>
    </>
  );
}
