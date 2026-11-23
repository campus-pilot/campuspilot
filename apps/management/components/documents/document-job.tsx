"use client";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DocumentJobProgress } from "@campuspilot/components/documents/document-job-progress";
import { DocumentNotice } from "@campuspilot/components/documents/document-controls";
import type {
  DocumentGenerationJobDto,
  DocumentType,
} from "@campuspilot/api/routers/school/document/document.dto";
import { orpc } from "@/lib/orpc";
import { DocumentReadError } from "./document-common";

/** How often a job that has not ended is read again. */
const JOB_POLL_MS = 2_000;

const isActive = (job: Pick<DocumentGenerationJobDto, "status"> | undefined) =>
  job?.status === "queued" || job?.status === "running";

/**
 * Reads a PDF generation job and keeps reading it every two seconds until it
 * has ended (TanStack Query's `refetchInterval`; no effect). The job started
 * by this dialog seeds the cache, so its progress shows at once.
 */
export function useDocumentJob(input: {
  schoolId: string;
  jobId: string;
  documentType: DocumentType;
  initial?: DocumentGenerationJobDto;
}) {
  return useQuery({
    ...orpc.school.getDocumentGenerationJob.queryOptions({
      input: { schoolId: input.schoolId, jobId: input.jobId, documentType: input.documentType },
    }),
    ...(input.initial ? { initialData: input.initial } : {}),
    refetchInterval: (query) => (isActive(query.state.data) ? JOB_POLL_MS : false),
  });
}

/**
 * The progress of a PDF this screen started, then `ready(artifactId)` (the
 * download and history actions) once it exists. Leaving the screen only
 * stops watching: the job runs on in the worker.
 */
export function DocumentJobTracker({
  schoolId,
  job: initial,
  ready,
}: {
  schoolId: string;
  job: DocumentGenerationJobDto;
  ready: (artifactId: string) => ReactNode;
}) {
  const job = useDocumentJob({
    schoolId,
    jobId: initial.id,
    documentType: initial.documentType,
    initial,
  });
  if (job.isError)
    return <DocumentReadError error={job.error} retry={job.refetch} />;
  const current = job.data ?? initial;
  return (
    <div className="flex flex-col gap-3">
      {current.warnings.map((warning) => (
        <DocumentNotice key={warning}>{warning}</DocumentNotice>
      ))}
      <DocumentJobProgress
        job={current}
        ready={current.artifactId ? ready(current.artifactId) : null}
      />
    </div>
  );
}
