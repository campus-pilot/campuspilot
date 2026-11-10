'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type {
  DemoSchoolJobDto,
  DemoSchoolPurgeDto,
} from '@campuspilot/api/routers/system-admin/demo-school/demo-school.dto';
import { Button } from '@campuspilot/ui/components/button';
import { toast } from '@campuspilot/ui/lib/toast';
import { CircleCheck, CircleX, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { DemoCredentialsButton } from './demo-credentials-button';
import { DemoJobCommandButton } from './demo-job-command-button';
import { useDemoJobLive, useDemoPurgeLive, useRetryDemoPurge } from './demo-job-hooks';
import { describeDemoJob, describeDemoPurge, type ProgressDescription, type ProgressTone } from './demo-job-labels';

/**
 * Persistent progress toasts for demo seeding and purges. Each toast body is
 * a component inside the Toaster (which sits inside the query provider), so
 * it follows its job through the shared live query: no effect and no
 * imperative toast updates. Showing the same job again reuses its toast ID.
 * Dismissing a toast only closes its stream; the workflow keeps running and
 * the organizations table still shows its status.
 */

function ToneIcon({ tone }: { tone: ProgressTone }) {
  if (tone === 'success') return <CircleCheck className="size-4 text-primary" aria-hidden />;
  if (tone === 'error') return <CircleX className="size-4 text-destructive" aria-hidden />;
  return <LoaderCircle className="size-4 animate-spin" aria-hidden />;
}

/** The shared toast frame: icon, title, status line, extra content and a close button. */
function ProgressToastFrame({
  toastId,
  title,
  progress,
  children,
}: {
  toastId: string | number;
  title: string;
  progress: ProgressDescription;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-(--width) items-start gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <span className="pt-0.5">
        <ToneIcon tone={progress.tone} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {progress.position ? `Step ${progress.position.current} of ${progress.position.total} · ` : null}
            {progress.detail}
          </p>
        </div>
        {children}
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={() => toast.dismiss(toastId)}>
        <X aria-hidden />
      </Button>
    </div>
  );
}

/** Links and downloads once a job succeeded; Start/Retry while it can be started again. */
function DemoJobToastActions({ job, toastId }: { job: DemoSchoolJobDto; toastId: string | number }) {
  if (job.status === 'succeeded') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link href={`/school/${job.schoolId}`} onClick={() => toast.dismiss(toastId)}>
            Open school
          </Link>
        </Button>
        {job.summary?.hasCredentials ? <DemoCredentialsButton schoolId={job.schoolId} size="sm" /> : null}
      </div>
    );
  }
  return <DemoJobCommandButton job={job} size="sm" />;
}

function DemoJobToast({
  toastId,
  jobId,
  schoolName,
  notice,
}: {
  toastId: string | number;
  jobId: string;
  schoolName: string;
  notice: string | null;
}) {
  const jobQuery = useDemoJobLive(jobId);
  const title = `Demo school: ${schoolName}`;
  if (jobQuery.isPending) {
    return <ProgressToastFrame toastId={toastId} title={title} progress={{ tone: 'active', detail: 'Connecting…', position: null }} />;
  }
  if (jobQuery.isError) {
    const detail = jobQuery.error instanceof Error ? jobQuery.error.message : 'Progress is unavailable.';
    return (
      <ProgressToastFrame toastId={toastId} title={title} progress={{ tone: 'error', detail, position: null }}>
        <p className="text-xs text-muted-foreground">Seeding continues; the organizations table shows its status.</p>
      </ProgressToastFrame>
    );
  }
  return (
    <ProgressToastFrame toastId={toastId} title={title} progress={describeDemoJob(jobQuery.data)}>
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      <DemoJobToastActions job={jobQuery.data} toastId={toastId} />
    </ProgressToastFrame>
  );
}

function RetryPurgeButton({ schoolId }: { schoolId: string }) {
  const retry = useRetryDemoPurge(schoolId);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
        {retry.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
        Retry purge
      </Button>
      {retry.isError ? (
        <p className="text-xs text-destructive">{retry.error instanceof Error ? retry.error.message : 'Unable to retry.'}</p>
      ) : null}
    </div>
  );
}

function DemoPurgeToast({ toastId, schoolId, schoolName }: { toastId: string | number; schoolId: string; schoolName: string }) {
  const purgeQuery = useDemoPurgeLive(schoolId);
  const title = `Purging ${schoolName}`;
  if (purgeQuery.isPending) {
    return <ProgressToastFrame toastId={toastId} title={title} progress={{ tone: 'active', detail: 'Connecting…', position: null }} />;
  }
  if (purgeQuery.isError) {
    const detail = purgeQuery.error instanceof Error ? purgeQuery.error.message : 'Progress is unavailable.';
    return <ProgressToastFrame toastId={toastId} title={title} progress={{ tone: 'error', detail, position: null }} />;
  }
  const purge: DemoSchoolPurgeDto = purgeQuery.data;
  return (
    <ProgressToastFrame toastId={toastId} title={purge.status === 'completed' ? `Purged ${schoolName}` : title} progress={describeDemoPurge(purge)}>
      {purge.status === 'failed' && !purge.automaticRetryPending ? <RetryPurgeButton schoolId={schoolId} /> : null}
    </ProgressToastFrame>
  );
}

/** Shows (or re-shows) the persistent progress toast of a seeding job. */
export function showDemoJobToast(options: { jobId: string; schoolName: string; notice?: string | null }) {
  toast.custom(
    (toastId) => <DemoJobToast toastId={toastId} jobId={options.jobId} schoolName={options.schoolName} notice={options.notice ?? null} />,
    { id: `demo-job-${options.jobId}`, duration: Number.POSITIVE_INFINITY },
  );
}

/** Shows (or re-shows) the persistent progress toast of a purge. */
export function showDemoPurgeToast(options: { schoolId: string; schoolName: string }) {
  toast.custom(
    (toastId) => <DemoPurgeToast toastId={toastId} schoolId={options.schoolId} schoolName={options.schoolName} />,
    { id: `demo-purge-${options.schoolId}`, duration: Number.POSITIVE_INFINITY },
  );
}
