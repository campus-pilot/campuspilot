'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartLineIcon, ChevronRightIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
import type { CadetGrowthDto } from '@campuspilot/api/routers/cadet/cadet.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@campuspilot/ui/components/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@campuspilot/ui/components/tabs';
import { Badge } from '@campuspilot/ui/components/reui/badge';
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@campuspilot/ui/components/reui/timeline';
import { cn } from '@campuspilot/ui/lib/utils';

import { firstNameOf, formatMonth, formatPercent, signedPoints } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { EmptyState, ScreenError, ScreenHeader, ScreenLoading, SectionLabel } from '../screen';

type ClassRecord = CadetGrowthDto['classes'][number];
type Selected = NonNullable<CadetGrowthDto['selected']>;

/** Short axis label: short names stay, longer ones become initials ("Half-Yearly" → "HY", "Unit Test 1" → "UT1"). */
export function shortLabel(name: string, max = 8) {
  if (name.length <= max) return name;
  const words = name.split(/[\s-]+/).filter(Boolean);
  if (words.length === 1) return name.slice(0, 4);
  return words.map((word) => (/^\d+$/.test(word) ? word : word[0]!.toUpperCase())).join('');
}

const classLabel = (record: ClassRecord) => [record.classLabel, record.sectionLabel].filter(Boolean).join(' ');

/** The chosen class lives in the URL (`?class=`), so the view survives a reload and can be shared. */
function ClassSelect({ classes, value }: { classes: ClassRecord[]; value: string }) {
  const router = useRouter();
  return (
    <Select value={value} onValueChange={(id) => router.replace(`/growth?class=${encodeURIComponent(id)}`, { scroll: false })}>
      <SelectTrigger aria-label="Class">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {classes.map((item) => (
          <SelectItem key={item.recordId} value={item.recordId}>
            {item.classLabel} · {item.sessionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Overall percentage for every released exam in one class. Overall scores are
 * the only numbers that stay comparable when classes define different
 * subjects, so this card is the growth headline.
 */
export function OverallTrend({ growth, studentName }: { growth: CadetGrowthDto; studentName: string }) {
  const selected = growth.selected!;
  const record = growth.classes.find((item) => item.recordId === selected.recordId)!;
  const first = selected.exams[0];
  const last = selected.exams.at(-1);
  const hasAverage = selected.exams.some((exam) => exam.classAveragePercentage !== null);
  const change = first && last ? last.percentage - first.percentage : 0;
  const config = {
    percentage: { label: firstNameOf(studentName), color: 'var(--primary)' },
    classAveragePercentage: { label: 'Class average', color: 'var(--color-zinc-400)' },
  } satisfies ChartConfig;
  const data = selected.exams.map((exam) => ({ ...exam, short: shortLabel(exam.name) }));
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription>{record.sessionIsActive ? 'Overall so far' : 'Overall, latest exam'}</CardDescription>
        <CardTitle className="flex flex-wrap items-center gap-2 text-2xl tabular-nums">
          {last ? formatPercent(last.percentage) : '—'}
          {selected.exams.length > 1 ? (
            <Badge variant={change >= 0 ? 'success-light' : 'destructive-light'} radius="full">
              {change >= 0 ? <TrendingUpIcon /> : <TrendingDownIcon />} {signedPoints(change)} since {shortLabel(first!.name)}
            </Badge>
          ) : null}
        </CardTitle>
        <CardAction>
          <ClassSelect classes={growth.classes} value={selected.recordId} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-2">
        {selected.exams.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No released results for {record.classLabel} yet.</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-48 w-full">
            <LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="short" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={28} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {hasAverage ? (
                <Line dataKey="classAveragePercentage" stroke="var(--color-classAveragePercentage)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
              ) : null}
              <Line dataKey="percentage" stroke="var(--color-percentage)" strokeWidth={2.5} dot={{ r: 3.5, fill: 'var(--color-percentage)' }} />
              <ChartLegend content={<ChartLegendContent />} />
            </LineChart>
          </ChartContainer>
        )}
        {selected.exams.length > 0 && !hasAverage ? (
          <p className="px-2 text-xs text-muted-foreground">Your school doesn&apos;t share class averages.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Subject changes between the class's last two released exams. Subjects are
 * matched by this class's own subject ids, never by name across classes.
 */
export function subjectChanges(selected: Selected) {
  const [previous, latest] = selected.exams.slice(-2);
  if (!previous || !latest) return [];
  return selected.subjects
    .filter((subject) => subject.subjectId in latest.subjects && subject.subjectId in previous.subjects)
    .map((subject) => ({ subject, change: latest.subjects[subject.subjectId]! - previous.subjects[subject.subjectId]! }))
    .sort((a, b) => b.change - a.change);
}

function ChangeList({ title, tone, items }: { title: string; tone: 'up' | 'down'; items: ReturnType<typeof subjectChanges> }) {
  const Icon = tone === 'up' ? TrendingUpIcon : TrendingDownIcon;
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border p-3', tone === 'up' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-rose-500/20 bg-rose-500/5')}>
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', tone === 'up' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
        <Icon className="size-3.5" /> {title}
      </span>
      {items.length === 0 ? <span className="text-sm text-muted-foreground">Nothing here</span> : null}
      {items.map(({ subject, change }) => (
        <span key={subject.subjectId} className="text-sm font-medium tabular-nums">
          {subject.name} {signedPoints(change)}
        </span>
      ))}
    </div>
  );
}

/** The two biggest gains and drops between the class's last two exams. */
function StrengthsAndFocus({ selected }: { selected: Selected }) {
  const changes = subjectChanges(selected);
  if (changes.length === 0) return null;
  const [previous, latest] = selected.exams.slice(-2);
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>
        {latest!.name} vs {previous!.name}
      </SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <ChangeList title="Improving" tone="up" items={changes.filter((item) => item.change > 0).slice(0, 2)} />
        <ChangeList title="Needs attention" tone="down" items={changes.filter((item) => item.change < 0).reverse().slice(0, 2)} />
      </div>
    </section>
  );
}

function SubjectBars({ data, baselineLabel, scoreLabel }: { data: { subject: string; score: number; baseline: number | null }[]; baselineLabel: string; scoreLabel: string }) {
  const config = {
    baseline: { label: baselineLabel, color: 'color-mix(in oklch, var(--muted-foreground) 40%, transparent)' },
    score: { label: scoreLabel, color: 'var(--primary)' },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-52 w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }} barGap={2}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="subject" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="baseline" fill="var(--color-baseline)" radius={3} />
        <Bar dataKey="score" fill="var(--color-score)" radius={3} />
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * The latest exam's subjects against two baselines, both inside the same
 * class: the previous exam, and the class average when the school shares it.
 */
function SubjectComparison({ selected, classLabel: label }: { selected: Selected; classLabel: string }) {
  const latest = selected.exams.at(-1);
  if (!latest) return null;
  const previous = selected.exams.at(-2);
  const rows = (baseline: Record<string, number>) =>
    selected.subjects
      .filter((subject) => subject.subjectId in latest.subjects)
      .map((subject) => ({ subject: shortLabel(subject.name, 5), score: latest.subjects[subject.subjectId]!, baseline: baseline[subject.subjectId] ?? null }));
  const options = [
    previous && { value: 'previous', tab: `vs ${previous.name}`, bars: rows(previous.subjects), baselineLabel: previous.name },
    latest.subjectAverages && { value: 'average', tab: 'vs class average', bars: rows(latest.subjectAverages), baselineLabel: 'Class average' },
  ].filter((option): option is { value: string; tab: string; bars: ReturnType<typeof rows>; baselineLabel: string } => !!option);
  if (options.length === 0) return null;
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Subjects in {latest.name}</CardTitle>
        <CardDescription>
          {options.length === 1 ? `${options[0]!.tab}, ` : ''}% per subject, {label} subjects only
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        {options.length === 1 ? (
          <SubjectBars data={options[0]!.bars} baselineLabel={options[0]!.baselineLabel} scoreLabel={latest.name} />
        ) : (
          <Tabs defaultValue={options[0]!.value} key={selected.recordId}>
            <TabsList className="mx-2 w-[calc(100%-1rem)]">
              {options.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.tab}
                </TabsTrigger>
              ))}
            </TabsList>
            {options.map((option) => (
              <TabsContent key={option.value} value={option.value}>
                <SubjectBars data={option.bars} baselineLabel={option.baselineLabel} scoreLabel={latest.name} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

/** One row per class: its latest overall % and the gap to the class average. Tapping switches the view to that class. */
function ClassRow({ record, selected }: { record: ClassRecord; selected: boolean }) {
  const latest = record.latest;
  return (
    <Link
      href={`/growth?class=${encodeURIComponent(record.recordId)}`}
      scroll={false}
      aria-current={selected ? 'true' : undefined}
      className={cn('flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/50', selected && 'bg-primary/5')}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{classLabel(record)}</span>
        <span className="text-xs text-muted-foreground">
          {record.sessionLabel}
          {latest ? ` · ${record.sessionIsActive ? 'so far, ' : ''}${latest.examName}` : ''}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm font-semibold tabular-nums">{latest ? formatPercent(latest.percentage) : '—'}</span>
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
          {!latest ? 'No results yet' : latest.classAveragePercentage === null ? 'No class average' : `${signedPoints(latest.percentage - latest.classAveragePercentage)} vs class`}
        </span>
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** Year-on-year view built only from overall scores, which stay comparable across classes. */
function ClassByClass({ growth }: { growth: CadetGrowthDto }) {
  if (growth.classes.length < 2) return null;
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Class by class</SectionLabel>
      <div className="flex flex-col overflow-hidden rounded-lg border">
        {growth.classes.map((record) => (
          <ClassRow key={record.recordId} record={record} selected={record.recordId === growth.selected?.recordId} />
        ))}
      </div>
    </section>
  );
}

/** Teacher remarks the school released for the chosen class, newest first. */
function RemarkTimeline({ recordId, label }: { recordId: string; label: string }) {
  const remarks = useQuery(orpc.listRemarks.queryOptions({ input: { filters: { recordId } } }));
  if (remarks.isPending) return <Skeleton className="h-32 w-full" aria-label="Loading teacher remarks" />;
  if (remarks.isError)
    return <ScreenError title="Could not load teacher remarks" error={remarks.error} onRetry={() => void remarks.refetch()} />;
  if (remarks.data.items.length === 0) return null;
  const items = remarks.data.items;
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Teacher remarks · {label}</SectionLabel>
      <Timeline defaultValue={items.length} key={recordId}>
        {items.map((remark, index) => (
          <TimelineItem key={remark.examId} step={index + 1}>
            <TimelineHeader>
              <TimelineSeparator />
              <TimelineDate>{formatMonth(remark.updatedAt)}</TimelineDate>
              <TimelineTitle>{remark.examName}</TimelineTitle>
              <TimelineIndicator />
            </TimelineHeader>
            <TimelineContent className="flex flex-col gap-1">
              <span className="text-foreground">“{remark.text}”</span>
              {remark.authorName ? <span className="text-xs">— {remark.authorName}</span> : null}
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </section>
  );
}

export function GrowthView({ growth, studentName }: { growth: CadetGrowthDto; studentName: string }) {
  if (!growth.selected)
    return (
      <>
        <ScreenHeader title="Growth" />
        <EmptyState icon={ChartLineIcon} title="Nothing to compare yet" description="Growth appears once your school releases your first examination results." />
      </>
    );
  const record = growth.classes.find((item) => item.recordId === growth.selected!.recordId)!;
  return (
    <>
      <ScreenHeader title="Growth" description={`${classLabel(record)} · ${record.sessionLabel}`} />
      <OverallTrend growth={growth} studentName={studentName} />
      <StrengthsAndFocus selected={growth.selected} />
      <SubjectComparison selected={growth.selected} classLabel={record.classLabel} />
      <ClassByClass growth={growth} />
      <RemarkTimeline recordId={record.recordId} label={record.classLabel} />
    </>
  );
}

/**
 * Growth is scoped to one class at a time. Each class defines its own
 * subjects, so subject charts never cross a class boundary; only overall
 * scores are compared between classes, in "Class by class".
 */
export function GrowthScreen() {
  const recordId = useSearchParams().get('class') ?? undefined;
  const profile = useQuery(orpc.getProfile.queryOptions());
  const growth = useQuery(orpc.getGrowth.queryOptions({ input: recordId ? { recordId } : {} }));
  if (growth.isPending || profile.isPending) return <ScreenLoading blocks={3} />;
  if (growth.isError) {
    if ((growth.error as { code?: string }).code === 'NOT_FOUND')
      return (
        <>
          <EmptyState icon={ChartLineIcon} title="Class not found" description="This class is not one of yours." />
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link href="/growth">Show my current class</Link>
          </Button>
        </>
      );
    return <ScreenError error={growth.error} onRetry={() => void growth.refetch()} />;
  }
  return <GrowthView growth={growth.data} studentName={profile.data?.name ?? ''} />;
}

