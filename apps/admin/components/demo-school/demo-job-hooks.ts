'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DemoSchoolJobDto } from '@campuspilot/api/routers/system-admin/demo-school/demo-school.dto';
import { client, orpc } from '@/lib/orpc';

/** Poll while the job can still change; stop once it succeeded or failed. */
function pollWhileActive(job: DemoSchoolJobDto | undefined, intervalMs: number) {
  return job && (job.status === 'queued' || job.status === 'running') ? intervalMs : false;
}

export function useDemoSchoolJob(jobId: string) {
  return useQuery(
    orpc.systemAdmin.getDemoSchoolJob.queryOptions({
      input: { jobId },
      refetchInterval: (query) => pollWhileActive(query.state.data, 2_000),
    }),
  );
}

export function useSchoolDemoJob(schoolId: string) {
  return useQuery(
    orpc.systemAdmin.getSchoolDemoJob.queryOptions({
      input: { schoolId },
      refetchInterval: (query) => pollWhileActive(query.state.data, 5_000),
    }),
  );
}

/**
 * Start (queued) or retry (failed) a job, then refresh every view of it:
 * the progress dialog, the table row and the school list.
 */
export function useDemoJobCommand(job: DemoSchoolJobDto) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      job.status === 'failed'
        ? client.systemAdmin.retryDemoSchoolJob({ jobId: job.id })
        : client.systemAdmin.startDemoSchoolJob({ jobId: job.id }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.getDemoSchoolJob.queryKey({ input: { jobId: job.id } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.getSchoolDemoJob.queryKey({ input: { schoolId: job.schoolId } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchools.queryKey({ input: {} }) }),
      ]);
    },
  });
}
