'use client';

import type { DemoSchoolJobDto } from '@campuspilot/api/routers/system-admin/demo-school/demo-school.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { DemoJobCommandButton } from './demo-job-command-button';
import { useDemoJobLive, useSchoolDemoJob } from './demo-job-hooks';
import { isFinishedJob } from './demo-job-labels';

/**
 * Seeding status of a demo school row, decided by the job's own status. The
 * latest job is read once; while it can still change, the row follows the
 * same live stream as the progress toast (one shared query per job).
 */
export function DemoSchoolJobStatus({ schoolId }: { schoolId: string }) {
  const jobQuery = useSchoolDemoJob(schoolId);
  if (jobQuery.isPending) return <Badge variant="outline">Loading…</Badge>;
  if (jobQuery.isError) return <Badge variant="outline">Setup pending</Badge>;
  if (isFinishedJob(jobQuery.data) || jobQuery.data.purgeRequestedAt) return <DemoJobBadge job={jobQuery.data} />;
  return <LiveDemoJobBadge jobId={jobQuery.data.id} fallback={jobQuery.data} />;
}

function LiveDemoJobBadge({ jobId, fallback }: { jobId: string; fallback: DemoSchoolJobDto }) {
  const liveQuery = useDemoJobLive(jobId);
  return <DemoJobBadge job={liveQuery.data ?? fallback} />;
}

function DemoJobBadge({ job }: { job: DemoSchoolJobDto }) {
  if (job.purgeRequestedAt) return <Badge variant="destructive">Purging…</Badge>;
  if (job.status === 'succeeded') return <Badge variant="secondary">Onboarded</Badge>;
  if (job.status === 'running') return <Badge variant="outline">Seeding…</Badge>;
  if (job.status === 'queued' && job.startRequestedAt) return <Badge variant="outline">Starting…</Badge>;
  return (
    <span className="flex items-center gap-2">
      <Badge variant={job.status === 'failed' ? 'destructive' : 'outline'}>
        {job.status === 'failed' ? 'Failed' : 'Queued'}
      </Badge>
      <DemoJobCommandButton job={job} size="sm" />
    </span>
  );
}
