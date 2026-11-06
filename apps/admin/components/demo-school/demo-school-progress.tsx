'use client';

import Link from 'next/link';
import type { DemoSchoolJobDto } from '@campuspilot/api/routers/system-admin/demo-school/demo-school.dto';
import { Button } from '@campuspilot/ui/components/button';
import { CircleCheck, CircleDashed, CircleX, LoaderCircle, RotateCcw } from 'lucide-react';
import { DemoCredentialsButton } from './demo-credentials-button';
import { useDemoJobCommand, useDemoSchoolJob } from './demo-job-hooks';

const STEP_LABELS: Record<DemoSchoolJobDto['steps'][number], string> = {
  staff: 'Staff',
  session: 'Session',
  classes: 'Classes',
  students: 'Students',
  exams: 'Exams',
  finance: 'Finance',
  templates: 'Templates',
  credentials: 'Credentials',
};

type StepState = 'done' | 'running' | 'failed' | 'pending';

function stepState(job: DemoSchoolJobDto, step: DemoSchoolJobDto['steps'][number]): StepState {
  if (job.completedSteps.includes(step)) return 'done';
  if (job.status === 'failed' && (job.currentStep === step || job.error?.step === step)) return 'failed';
  if (job.status === 'running' && job.currentStep === step) return 'running';
  return 'pending';
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CircleCheck className="size-4 text-primary" aria-hidden />;
  if (state === 'running') return <LoaderCircle className="size-4 animate-spin" aria-hidden />;
  if (state === 'failed') return <CircleX className="size-4 text-destructive" aria-hidden />;
  return <CircleDashed className="size-4 text-muted-foreground" aria-hidden />;
}

function DemoJobStepList({ job }: { job: DemoSchoolJobDto }) {
  const steps = [...job.steps.map((step) => ({ key: step, label: STEP_LABELS[step], state: stepState(job, step) })),
    { key: 'done', label: 'Done', state: (job.status === 'succeeded' ? 'done' : 'pending') as StepState }];
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2 text-sm" data-state={step.state}>
          <StepIcon state={step.state} />
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function formatMinor(minor: string, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(minor) / 100);
}

function DemoJobSummary({ summary }: { summary: NonNullable<DemoSchoolJobDto['summary']> }) {
  const { counts, amounts } = summary;
  const items = [
    ['Students', String(counts.students)],
    ['Bills', String(counts.bills)],
    ['Collected', formatMinor(amounts.collectedMinor, amounts.currency)],
    ['Outstanding', formatMinor(amounts.outstandingMinor, amounts.currency)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Start (queued) or retry (failed) the job. */
export function DemoJobCommandButton({ job, size }: { job: DemoSchoolJobDto; size?: 'sm' }) {
  const command = useDemoJobCommand(job);
  if (job.status !== 'queued' && job.status !== 'failed') return null;
  return (
    <Button type="button" variant="outline" size={size} disabled={command.isPending} onClick={() => command.mutate()}>
      {command.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
      {job.status === 'failed' ? 'Retry' : 'Start seeding'}
    </Button>
  );
}

function DemoJobOutcome({ job }: { job: DemoSchoolJobDto }) {
  if (job.status === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">
          {job.error ? `${STEP_LABELS[job.error.step as keyof typeof STEP_LABELS] ?? job.error.step}: ${job.error.message}` : 'Seeding failed.'}
        </p>
        <DemoJobCommandButton job={job} />
      </div>
    );
  }
  if (job.status !== 'succeeded' || !job.summary) return job.status === 'queued' ? <DemoJobCommandButton job={job} /> : null;
  return (
    <div className="flex flex-col gap-3">
      <DemoJobSummary summary={job.summary} />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild><Link href={`/school/${job.schoolId}`}>Open school</Link></Button>
        {job.summary.hasCredentials ? <DemoCredentialsButton schoolId={job.schoolId} /> : null}
      </div>
    </div>
  );
}

/** Progress of one seeding job, refreshed by polling while it runs. */
export function DemoSchoolProgress({ jobId, notice }: { jobId: string; schoolId: string; notice: string | null }) {
  const jobQuery = useDemoSchoolJob(jobId);

  if (jobQuery.isPending) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (jobQuery.isError) {
    return <p className="text-sm text-destructive">{jobQuery.error instanceof Error ? jobQuery.error.message : 'Unable to load the job.'}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      <DemoJobStepList job={jobQuery.data} />
      <DemoJobOutcome job={jobQuery.data} />
    </div>
  );
}
