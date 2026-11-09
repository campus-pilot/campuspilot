'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChevronRightIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
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

import { ScreenHeader, SectionLabel } from './concept-shell';
import { type ClassRecord, classHistory, student } from './mock-data';

/** "Class 7 B · 2026–27", the label used wherever a class is named. */
function classLabel(record: ClassRecord) {
  return `${record.className} ${record.section} · ${record.session}`;
}

/** Signed one-decimal point difference, e.g. "+3.3" or "−1.2". */
function signed(value: number) {
  const rounded = Math.abs(value).toFixed(1).replace(/\.0$/, '');
  return `${value < 0 ? '−' : '+'}${rounded}`;
}

/**
 * The class switcher. The chosen class lives in the URL (`?class=`) rather
 * than component state, so the view survives a reload and can be shared.
 */
function ClassSelect({ record }: { record: ClassRecord }) {
  const router = useRouter();
  return (
    <Select value={record.id} onValueChange={(id) => router.replace(`/concept/growth?class=${id}`, { scroll: false })}>
      <SelectTrigger aria-label="Class">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {classHistory.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.className}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const trendConfig = {
  overall: { label: student.name.split(' ')[0], color: 'var(--primary)' },
  classAverage: { label: 'Class average', color: 'var(--color-zinc-400)' },
} satisfies ChartConfig;

/**
 * Overall percentage for every released exam in one class. Overall scores are
 * the only numbers that stay comparable when classes define different
 * subjects, so this card is the growth headline.
 */
function OverallTrend({ record }: { record: ClassRecord }) {
  const first = record.exams[0]!;
  const last = record.exams.at(-1)!;
  const change = last.overall - first.overall;
  const hasAverage = record.exams.every((exam) => exam.classAverage !== null);
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription>{record.current ? 'Overall so far' : 'Overall, year end'}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-2xl tabular-nums">
          {last.overall}%
          {record.exams.length > 1 ? (
            <Badge variant={change >= 0 ? 'success-light' : 'destructive-light'} radius="full">
              {change >= 0 ? <TrendingUpIcon /> : <TrendingDownIcon />} {signed(change)} since {first.short}
            </Badge>
          ) : null}
        </CardTitle>
        <CardAction>
          <ClassSelect record={record} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-2">
        <ChartContainer config={trendConfig} className="aspect-auto h-48 w-full">
          <LineChart data={record.exams} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="short" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis domain={[50, 100]} tickLine={false} axisLine={false} width={28} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {hasAverage ? (
              <Line dataKey="classAverage" stroke="var(--color-classAverage)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
            ) : null}
            <Line dataKey="overall" stroke="var(--color-overall)" strokeWidth={2.5} dot={{ r: 3.5, fill: 'var(--color-overall)' }} />
            <ChartLegend content={<ChartLegendContent />} />
          </LineChart>
        </ChartContainer>
        {hasAverage ? null : (
          <p className="px-2 text-xs text-muted-foreground">The school didn’t share class averages for {record.className}.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Subject changes between the class's last two released exams. Subjects are
 * matched by the class's own subject ids, never by name across classes.
 */
function subjectChanges(record: ClassRecord) {
  const [previous, latest] = record.exams.slice(-2);
  if (!previous || !latest) return [];
  return record.subjects
    .map((subject) => ({ subject, change: (latest.scores[subject.id] ?? 0) - (previous.scores[subject.id] ?? 0) }))
    .sort((a, b) => b.change - a.change);
}

function ChangeList({ title, tone, items }: { title: string; tone: 'up' | 'down'; items: ReturnType<typeof subjectChanges> }) {
  const Icon = tone === 'up' ? TrendingUpIcon : TrendingDownIcon;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        tone === 'up' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-rose-500/20 bg-rose-500/5',
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-xs font-semibold',
          tone === 'up' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
        )}
      >
        <Icon className="size-3.5" /> {title}
      </span>
      {items.length === 0 ? <span className="text-sm text-muted-foreground">Nothing here</span> : null}
      {items.map(({ subject, change }) => (
        <span key={subject.id} className="text-sm font-medium tabular-nums">
          {subject.name} {signed(change)}
        </span>
      ))}
    </div>
  );
}

/** The two biggest gains and drops between the class's last two exams. */
function StrengthsAndFocus({ record }: { record: ClassRecord }) {
  const changes = subjectChanges(record);
  if (changes.length === 0) return null;
  const [previous, latest] = record.exams.slice(-2);
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>
        {latest!.name} vs {previous!.name}
      </SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <ChangeList title="Improving" tone="up" items={changes.filter((c) => c.change > 0).slice(0, 2)} />
        <ChangeList title="Needs attention" tone="down" items={changes.filter((c) => c.change < 0).reverse().slice(0, 2)} />
      </div>
    </section>
  );
}

const barConfig = {
  baseline: { label: 'Baseline', color: 'color-mix(in oklch, var(--muted-foreground) 40%, transparent)' },
  score: { label: 'Score', color: 'var(--primary)' },
} satisfies ChartConfig;

function SubjectBars({ data, baselineLabel, scoreLabel }: { data: { subject: string; score: number; baseline: number }[]; baselineLabel: string; scoreLabel: string }) {
  const config = { baseline: { ...barConfig.baseline, label: baselineLabel }, score: { ...barConfig.score, label: scoreLabel } } satisfies ChartConfig;
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
 * With only one baseline available the switcher is dropped.
 */
function SubjectComparison({ record }: { record: ClassRecord }) {
  const latest = record.exams.at(-1)!;
  const previous = record.exams.at(-2);
  const averages = latest.subjectAverages;
  const rows = (baseline: Record<string, number>) =>
    record.subjects.map((s) => ({ subject: s.short, score: latest.scores[s.id] ?? 0, baseline: baseline[s.id] ?? 0 }));
  const options = [
    previous && { value: 'previous', tab: `vs ${previous.name}`, bars: rows(previous.scores), baselineLabel: previous.name },
    averages && { value: 'average', tab: 'vs class average', bars: rows(averages), baselineLabel: 'Class average' },
  ].filter((option) => !!option);
  if (options.length === 0) return null;
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Subjects in {latest.name}</CardTitle>
        <CardDescription>
          {options.length === 1 ? `${options[0]!.tab}, ` : ''}% per subject, {record.className} subjects only
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        {options.length === 1 ? (
          <SubjectBars data={options[0]!.bars} baselineLabel={options[0]!.baselineLabel} scoreLabel={latest.name} />
        ) : (
          <Tabs defaultValue={options[0]!.value} key={record.id}>
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

/** One row per class: the class's latest overall % and its gap to the class average. Tapping switches the view to that class. */
function ClassRow({ record, selected }: { record: ClassRecord; selected: boolean }) {
  const last = record.exams.at(-1)!;
  return (
    <Link
      href={`/concept/growth?class=${record.id}`}
      scroll={false}
      aria-current={selected ? 'true' : undefined}
      className={cn('flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/50', selected && 'bg-primary/5')}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {record.className} {record.section}
        </span>
        <span className="text-xs text-muted-foreground">
          {record.session} · {record.current ? `so far, ${last.name}` : 'year end'}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm font-semibold tabular-nums">{last.overall}%</span>
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
          {last.classAverage === null ? 'No class average' : `${signed(last.overall - last.classAverage)} vs class`}
        </span>
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** Year-on-year view built only from overall scores, which stay comparable across classes. */
function ClassByClass({ record }: { record: ClassRecord }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Class by class</SectionLabel>
      <div className="flex flex-col overflow-hidden rounded-lg border">
        {classHistory.map((item) => (
          <ClassRow key={item.id} record={item} selected={item.id === record.id} />
        ))}
      </div>
    </section>
  );
}

/** Teacher remarks the school released for the chosen class, newest first. */
function RemarkTimeline({ record }: { record: ClassRecord }) {
  if (record.remarks.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Teacher remarks · {record.className}</SectionLabel>
      <Timeline defaultValue={record.remarks.length} key={record.id}>
        {record.remarks.map((remark, index) => (
          <TimelineItem key={remark.exam} step={index + 1}>
            <TimelineHeader>
              <TimelineSeparator />
              <TimelineDate>{remark.date}</TimelineDate>
              <TimelineTitle>{remark.exam}</TimelineTitle>
              <TimelineIndicator />
            </TimelineHeader>
            <TimelineContent className="flex flex-col gap-1">
              <span className="text-foreground">“{remark.text}”</span>
              <span className="text-xs">— {remark.teacher}</span>
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </section>
  );
}

/**
 * Growth is scoped to one class at a time. Each class defines its own subjects
 * (names, slugs and ids can differ between Class 6 and Class 7), so subject
 * charts never cross a class boundary; only overall scores are compared
 * between classes, in "Class by class".
 */
export function GrowthScreen({ record }: { record: ClassRecord }) {
  return (
    <>
      <ScreenHeader title="Growth" description={classLabel(record)} />
      <OverallTrend record={record} />
      <StrengthsAndFocus record={record} />
      <SubjectComparison record={record} />
      <ClassByClass record={record} />
      <RemarkTimeline record={record} />
    </>
  );
}
