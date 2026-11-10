'use client';

import type { DemoSchoolJobDto } from '@campuspilot/api/routers/system-admin/demo-school/demo-school.dto';
import { Button } from '@campuspilot/ui/components/button';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { useDemoJobCommand } from './demo-job-hooks';

/** Start (queued, not yet requested) or retry (failed) a seeding job. */
export function DemoJobCommandButton({ job, size }: { job: DemoSchoolJobDto; size?: 'sm' }) {
  const command = useDemoJobCommand(job);
  const canStart = job.status === 'queued' && !job.startRequestedAt && !job.purgeRequestedAt;
  const canRetry = job.status === 'failed' && !job.purgeRequestedAt;
  if (!canStart && !canRetry) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size={size} disabled={command.isPending} onClick={() => command.mutate()}>
        {command.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
        {canRetry ? 'Retry' : 'Start seeding'}
      </Button>
      {command.isError ? (
        <p className="text-xs text-destructive">
          {command.error instanceof Error ? command.error.message : 'Unable to start the job.'}
        </p>
      ) : null}
    </div>
  );
}
