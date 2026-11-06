'use client';

import { Badge } from '@campuspilot/ui/components/badge';
import { useSchoolDemoJob } from './demo-job-hooks';
import { DemoJobCommandButton } from './demo-school-progress';

/**
 * Seeding status of a demo school row that has not finished onboarding:
 * "Seeding…", "Queued" with Start seeding, or "Failed" with Retry.
 */
export function DemoSchoolJobStatus({ schoolId }: { schoolId: string }) {
  const jobQuery = useSchoolDemoJob(schoolId);
  if (jobQuery.isPending) return <Badge variant="outline">Loading…</Badge>;
  if (jobQuery.isError) return <Badge variant="outline">Setup pending</Badge>;
  const job = jobQuery.data;
  if (job.status === 'succeeded') return <Badge variant="secondary">Onboarded</Badge>;
  if (job.status === 'running') return <Badge variant="outline">Seeding…</Badge>;
  return (
    <span className="flex items-center gap-2">
      <Badge variant={job.status === 'failed' ? 'destructive' : 'outline'}>
        {job.status === 'failed' ? 'Failed' : 'Queued'}
      </Badge>
      <DemoJobCommandButton job={job} size="sm" />
    </span>
  );
}
