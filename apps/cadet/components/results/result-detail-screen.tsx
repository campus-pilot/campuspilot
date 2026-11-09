'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRightIcon, ArrowUpRightIcon, FileQuestionIcon, HourglassIcon, MessageSquareQuoteIcon } from 'lucide-react';
import type { CadetExamListItemDto, CadetExamResultDto } from '@campuspilot/api/routers/cadet/cadet.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Progress } from '@campuspilot/ui/components/progress';
import { Badge } from '@campuspilot/ui/components/reui/badge';
import { IconTile } from '@campuspilot/ui/components/reui/icon-tile';
import { cn } from '@campuspilot/ui/lib/utils';

import { formatDate, formatPercent, signedPoints } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { EmptyState, ScreenError, ScreenHeader, ScreenLoading, SectionLabel } from '../screen';

type Subject = CadetExamResultDto['subjects'][number];

/** The class record an exam id belongs to (`{studentId}.{classId}.{examSlug}`). */
export function recordIdOfExam(examId: string) {
  const [studentId, classId] = examId.split('.');
  return studentId && classId ? `${studentId}.${classId}` : null;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-4">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** Overall score, grade and attendance: the three things guardians ask about first. */
export function ResultSummary({ result }: { result: CadetExamResultDto }) {
  const attendance = result.attendance;
  return (
    <Card className="gap-0 py-0">
      <CardContent className="grid grid-cols-3 divide-x p-0 text-center">
        <Stat value={result.overall ? formatPercent(result.overall.percentage) : '—'} label="Overall" />
        <Stat value={result.overall?.grade ?? '—'} label="Grade" />
        <Stat
          value={attendance ? formatPercent(Math.round((attendance.daysAttended / attendance.totalWorkingDays) * 1000) / 10) : '—'}
          label={attendance ? `${attendance.daysAttended}/${attendance.totalWorkingDays} days` : 'Attendance'}
        />
      </CardContent>
    </Card>
  );
}

export function TeacherRemark({ remark }: { remark: NonNullable<CadetExamResultDto['remark']> }) {
  return (
    <Card className="gap-3 border-violet-500/20 bg-violet-500/5 py-4">
      <CardHeader className="flex flex-row items-center gap-2.5 px-4">
        <IconTile variant="soft" size="sm" className="text-violet-600">
          <MessageSquareQuoteIcon />
        </IconTile>
        <div className="flex flex-col">
          <CardTitle className="text-sm">{remark.authorName ?? 'Your teacher'}</CardTitle>
          <span className="text-xs text-muted-foreground">Teacher&apos;s remark</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 text-sm leading-relaxed whitespace-pre-wrap">“{remark.text}”</CardContent>
    </Card>
  );
}

/** Change against the same subject in the previous released exam of this class; never against classmates. */
export function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null) return null;
  const diff = Math.round((now - before) * 10) / 10;
  const Icon = diff >= 0 ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', diff >= 0 ? 'text-emerald-600' : 'text-rose-600')}
      aria-label={`${signedPoints(diff)} points since the previous exam`}
    >
      <Icon className="size-3.5" />
      {Math.abs(diff)}
    </span>
  );
}

function SubjectRow({ subject }: { subject: Subject }) {
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">{subject.name}</span>
        <Delta now={subject.percentage} before={subject.previousPercentage} />
        <span className="w-16 text-right text-sm font-semibold tabular-nums">
          {subject.obtained}/{subject.max}
        </span>
        <Badge variant="outline" className="min-w-7 justify-center">
          {subject.grade ?? '—'}
        </Badge>
      </div>
      <Progress value={subject.percentage} className="h-1.5" />
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground tabular-nums">
        {subject.modes.length > 1
          ? subject.modes.map((mode) => (
              <span key={mode.name}>
                {mode.name} {mode.obtained}/{mode.max}
              </span>
            ))
          : null}
        {subject.classAveragePercentage !== null ? <span>Class average {formatPercent(subject.classAveragePercentage)}</span> : null}
      </div>
    </div>
  );
}

function SubjectList({ result }: { result: CadetExamResultDto }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel action={result.previousExam ? <span className="text-xs text-muted-foreground">vs {result.previousExam.name}</span> : null}>
        Subjects
      </SectionLabel>
      <div className="rounded-lg border">
        {result.subjects.map((subject) => (
          <SubjectRow key={subject.subjectId} subject={subject} />
        ))}
      </div>
    </section>
  );
}

function CoScholastic({ areas }: { areas: CadetExamResultDto['coScholastics'] }) {
  if (areas.length === 0) return null;
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

export function ResultDetail({ result }: { result: CadetExamResultDto }) {
  return (
    <>
      <ScreenHeader title={result.name} description={`Released ${formatDate(result.releasedAt)} · ${result.classLabel} · ${result.sessionLabel}`} />
      <ResultSummary result={result} />
      {result.classAveragePercentage !== null ? (
        <p className="text-xs text-muted-foreground">Class average {formatPercent(result.classAveragePercentage)}</p>
      ) : null}
      {result.remark ? <TeacherRemark remark={result.remark} /> : null}
      {result.subjects.length > 0 ? (
        <SubjectList result={result} />
      ) : (
        <p className="text-sm text-muted-foreground">No marks were recorded for you in this examination.</p>
      )}
      <CoScholastic areas={result.coScholastics} />
      <Button asChild variant="outline" size="lg" className="w-full">
        <Link href={`/growth?class=${encodeURIComponent(result.recordId)}`}>See growth across exams</Link>
      </Button>
    </>
  );
}

/** Exam finished but the school has not released it: say so plainly, with no partial marks. */
export function AwaitingRelease({ exam }: { exam: CadetExamListItemDto }) {
  return (
    <>
      <ScreenHeader title={exam.name} />
      <EmptyState
        icon={HourglassIcon}
        title="Results not released yet"
        description="Your school has finished this examination. Results appear here as soon as the school releases them to the Cadet Portal."
      />
    </>
  );
}

function ReleasedResult({ examId }: { examId: string }) {
  const result = useQuery(orpc.getExamResult.queryOptions({ input: { examId } }));
  if (result.isPending) return <ScreenLoading blocks={3} />;
  if (result.isError) return <ScreenError error={result.error} onRetry={() => void result.refetch()} />;
  return <ResultDetail result={result.data} />;
}

const NotFound = () => (
  <EmptyState icon={FileQuestionIcon} title="Result not available" description="This examination does not exist or has no results to show." />
);

/**
 * Looks the exam up in its class's list first, so an unreleased exam shows
 * "awaiting release" without asking for marks the server would refuse.
 */
export function ResultDetailScreen({ examId }: { examId: string }) {
  const recordId = recordIdOfExam(examId);
  const exams = useQuery({
    ...orpc.listExams.queryOptions({ input: { filters: { recordId: recordId ?? '' } } }),
    enabled: recordId !== null,
  });
  if (recordId === null) return <NotFound />;
  if (exams.isPending) return <ScreenLoading blocks={3} />;
  if (exams.isError) {
    if ((exams.error as { code?: string }).code === 'NOT_FOUND') return <NotFound />;
    return <ScreenError error={exams.error} onRetry={() => void exams.refetch()} />;
  }
  const exam = exams.data.items.find((item) => item.examId === examId);
  if (exam?.state === 'released') return <ReleasedResult examId={examId} />;
  if (exam?.state === 'awaiting_release') return <AwaitingRelease exam={exam} />;
  return <NotFound />;
}
