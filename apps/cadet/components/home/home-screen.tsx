'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightIcon, SparklesIcon } from 'lucide-react';
import type { CadetExamListItemDto, CadetFeeSummaryDto, CadetProfileDto } from '@campuspilot/api/routers/cadet/cadet.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent } from '@campuspilot/ui/components/card';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@campuspilot/ui/components/reui/alert';
import { Badge } from '@campuspilot/ui/components/reui/badge';

import { absMinor, firstNameOf, formatDate, formatMoney, formatPercent, greetingFor, isZeroMinor } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { currentEnrollment } from '@/lib/profile';
import { ScreenError, ScreenLoading } from '../screen';

/** Greets by first name and states the session so a guardian knows which year they are looking at. */
export function Greeting({ profile, hour }: { profile: CadetProfileDto; hour: number }) {
  const enrollment = currentEnrollment(profile);
  const facts = [
    enrollment ? `Session ${enrollment.sessionLabel}` : null,
    enrollment?.rollNo != null ? `Roll ${enrollment.rollNo}` : null,
    `Adm. ${profile.admissionNo}`,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm text-muted-foreground">{greetingFor(hour)}</p>
      <h1 className="text-2xl font-semibold tracking-tight">Hi, {firstNameOf(profile.name)}</h1>
      <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p>
    </div>
  );
}

/**
 * The most recently released result of the current class. The portal does
 * not track which results a student has opened, so this always shows the
 * latest release rather than claiming it is unseen.
 */
export function LatestResultAlert({ exams }: { exams: CadetExamListItemDto[] }) {
  const latest = exams
    .filter((exam) => exam.state === 'released' && exam.releasedAt)
    .sort((a, b) => new Date(b.releasedAt!).getTime() - new Date(a.releasedAt!).getTime())[0];
  if (!latest) return null;
  const facts = [
    `Released ${formatDate(latest.releasedAt!, { withYear: false })}`,
    latest.percentage !== null ? formatPercent(latest.percentage) : null,
    latest.grade ? `Grade ${latest.grade}` : null,
  ].filter(Boolean);
  return (
    <Alert variant="success">
      <SparklesIcon />
      <AlertTitle>{latest.name} results are out</AlertTitle>
      <AlertDescription>{facts.join(' · ')}</AlertDescription>
      <AlertAction>
        <Button asChild variant="outline" size="sm">
          <Link href={`/results/${encodeURIComponent(latest.examId)}`}>Open</Link>
        </Button>
      </AlertAction>
    </Alert>
  );
}

/** The single most important money fact: what is owed now. Bills have no due date, so none is shown. */
export function FeeCard({ summary }: { summary: CadetFeeSummaryDto }) {
  return (
    <Card className="gap-0 overflow-hidden border-primary/20 bg-primary/5 py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        {summary.currencies.length === 0 ? (
          <span className="text-sm text-muted-foreground">No fees have been billed yet.</span>
        ) : (
          summary.currencies.map((row) => <FeeBalance key={row.currency} row={row} />)
        )}
        <Button asChild size="lg" className="w-full">
          <Link href="/fees">
            View fees & ledger <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function FeeBalance({ row }: { row: CadetFeeSummaryDto['currencies'][number] }) {
  const owed = !isZeroMinor(row.dueMinor);
  const inCredit = !isZeroMinor(row.creditMinor);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {owed ? 'Fees outstanding' : inCredit ? 'In credit' : 'Fees'}
        </span>
        {owed ? null : (
          <Badge variant="success-light" radius="full">
            {inCredit ? 'Advance paid' : 'All paid'}
          </Badge>
        )}
      </div>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">
        {formatMoney(owed ? row.dueMinor : absMinor(row.creditMinor), row.currency)}
      </p>
    </div>
  );
}

function HomeResults({ classKnown }: { classKnown: boolean }) {
  const exams = useQuery({ ...orpc.listExams.queryOptions({ input: {} }), enabled: classKnown });
  if (!classKnown || !exams.data) return null;
  return <LatestResultAlert exams={exams.data.items} />;
}

function HomeFees() {
  const summary = useQuery(orpc.getFeeSummary.queryOptions());
  if (summary.isPending) return null;
  if (summary.isError) return <ScreenError title="Could not load fees" error={summary.error} onRetry={() => void summary.refetch()} />;
  return <FeeCard summary={summary.data} />;
}

/** Greeting, then a fresh result, then the fee balance. Sections are reached through the bottom nav. */
export function HomeScreen() {
  const profile = useQuery(orpc.getProfile.queryOptions());
  if (profile.isPending) return <ScreenLoading blocks={2} />;
  if (profile.isError) return <ScreenError error={profile.error} onRetry={() => void profile.refetch()} />;
  return (
    <>
      <Greeting profile={profile.data} hour={new Date().getHours()} />
      <HomeResults classKnown={profile.data.enrollments.length > 0} />
      <HomeFees />
    </>
  );
}
