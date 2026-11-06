'use client';

import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  DemoSchoolJobDto,
  DemoSchoolPurgeDto,
} from '@campuspilot/api/routers/system-admin/demo-school/demo-school.dto';
import { client, orpc } from '@/lib/orpc';
import { isFinishedJob, isFinishedPurge } from './demo-job-labels';

/** Refreshes the school list and the table's per-school job status. */
async function refreshSchoolViews(queryClient: QueryClient, schoolId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.getSchoolDemoJob.queryKey({ input: { schoolId } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchools.key() }),
  ]);
}

/**
 * A live query over a server-sent event stream. Each event replaces the
 * query data as it arrives; the query function resolves with the last event.
 * A stream the server ended before a final state (its time limit) is opened
 * again. Aborting the query's signal (last observer gone, e.g. the toast was
 * dismissed) closes the stream; the server-side work continues regardless.
 * `onFinal` runs once a final state arrived, from the query function rather
 * than an effect.
 */
async function consumeLive<T>(options: {
  open: (signal: AbortSignal) => Promise<AsyncIterable<T>>;
  isFinal: (value: T) => boolean;
  publish: (value: T) => void;
  signal: AbortSignal;
  onFinal: (value: T) => Promise<void>;
}): Promise<T> {
  let last: T | undefined;
  while (!options.signal.aborted) {
    for await (const value of await options.open(options.signal)) {
      last = value;
      options.publish(value);
    }
    if (last === undefined || options.isFinal(last)) break;
  }
  if (last === undefined) throw new Error('The progress stream ended without any update.');
  if (options.isFinal(last)) await options.onFinal(last);
  return last;
}

/** Live state of one seeding job (`watchDemoSchoolJob`), shared by its toast and table row. */
export function demoJobLiveQuery(jobId: string) {
  const queryKey = orpc.systemAdmin.watchDemoSchoolJob.experimental_liveKey({ input: { jobId } });
  return queryOptions({
    queryKey,
    queryFn: ({ signal, client: queryClient }) =>
      consumeLive<DemoSchoolJobDto>({
        open: (abort) => client.systemAdmin.watchDemoSchoolJob({ jobId }, { signal: abort }),
        isFinal: isFinishedJob,
        publish: (job) => queryClient.setQueryData(queryKey, job),
        signal,
        onFinal: (job) => refreshSchoolViews(queryClient, job.schoolId),
      }),
    retry: 3,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

/** Live state of one purge (`watchDemoSchoolPurge`). */
export function demoPurgeLiveQuery(schoolId: string) {
  const queryKey = orpc.systemAdmin.watchDemoSchoolPurge.experimental_liveKey({ input: { schoolId } });
  return queryOptions({
    queryKey,
    queryFn: ({ signal, client: queryClient }) =>
      consumeLive<DemoSchoolPurgeDto>({
        open: (abort) => client.systemAdmin.watchDemoSchoolPurge({ schoolId }, { signal: abort }),
        isFinal: isFinishedPurge,
        publish: (purge) => queryClient.setQueryData(queryKey, purge),
        signal,
        onFinal: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchools.key() }),
            queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listDemoSchoolPurges.key() }),
          ]);
        },
      }),
    retry: 3,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

export function useDemoJobLive(jobId: string) {
  return useQuery(demoJobLiveQuery(jobId));
}

export function useDemoPurgeLive(schoolId: string) {
  return useQuery(demoPurgeLiveQuery(schoolId));
}

/** The school's latest job, read once; an active one is followed live by its row. */
export function useSchoolDemoJob(schoolId: string) {
  return useQuery(orpc.systemAdmin.getSchoolDemoJob.queryOptions({ input: { schoolId } }));
}

/**
 * Start (queued) or retry (failed) a job. Both return at once; the live
 * query is then reopened so the toast and table follow the new attempt.
 */
export function useDemoJobCommand(job: DemoSchoolJobDto) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      job.status === 'failed'
        ? client.systemAdmin.retryDemoSchoolJob({ jobId: job.id })
        : client.systemAdmin.startDemoSchoolJob({ jobId: job.id }),
    onSuccess: async (updated) => {
      const live = demoJobLiveQuery(job.id);
      queryClient.setQueryData(live.queryKey, updated);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: live.queryKey }),
        refreshSchoolViews(queryClient, job.schoolId),
      ]);
    },
  });
}

/** Retry a failed purge; the live query and the attention list follow the new attempt. */
export function useRetryDemoPurge(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.systemAdmin.retryDemoSchoolPurge({ schoolId }),
    onSuccess: async (updated) => {
      const live = demoPurgeLiveQuery(schoolId);
      queryClient.setQueryData(live.queryKey, updated);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: live.queryKey }),
        queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listDemoSchoolPurges.key() }),
      ]);
    },
  });
}
