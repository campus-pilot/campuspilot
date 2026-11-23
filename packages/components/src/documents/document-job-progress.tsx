"use client";
import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { Progress } from "@campuspilot/ui/components/progress";

/**
 * What the progress view needs of a PDF generation job (the
 * `getDocumentGenerationJob` result); the caller reads and refreshes it.
 */
export type DocumentJobView = {
  status: "queued" | "running" | "succeeded" | "failed";
  /** Documents when the job was requested. */
  documentCount: number;
  /** Documents the PDF prints, once the worker prepared the job (null before); shown when known. */
  printedDocumentCount: number | null;
  /** Null until the documents are split into parts. */
  batchCount: number | null;
  batchesDone: number;
  errorMessage: string | null;
};

/**
 * How far a job is, 0 to 100. Splitting the documents counts as the first
 * tenth; the parts share the rest, and the last step (joining the parts)
 * happens at 100 % of the parts, so a running job never shows 100.
 */
export function documentJobPercent(job: DocumentJobView) {
  if (job.status === "succeeded") return 100;
  if (job.status !== "running" || job.batchCount === null) return job.status === "running" ? 5 : 0;
  return Math.min(95, 10 + Math.round((85 * job.batchesDone) / job.batchCount));
}

const documents = (count: number) => `${count.toLocaleString("en-IN")} document${count === 1 ? "" : "s"}`;

/** The line under the title: what is happening now. */
function progressDetail(job: DocumentJobView) {
  const count = job.printedDocumentCount ?? job.documentCount;
  if (job.status === "queued")
    return "Waiting to start. This school's PDFs are created one at a time.";
  if (job.batchCount === null) return `Preparing ${documents(count)}…`;
  if (job.batchesDone < job.batchCount)
    return `Creating part ${job.batchesDone + 1} of ${job.batchCount} (${documents(count)})…`;
  return job.batchCount > 1 ? "Joining the parts into one PDF…" : "Saving the PDF…";
}

/**
 * The state of a PDF that is being created in the background: waiting,
 * progress with the part being converted, the failure message, or (when it
 * is ready) the caller's `ready` content (download and history actions).
 * Closing the view does not stop the job; the hint says so.
 */
export function DocumentJobProgress({
  job,
  ready,
  closeHint = true,
}: {
  job: DocumentJobView;
  /** Shown when the PDF is ready, under the confirmation. */
  ready?: ReactNode;
  /** Says the window can be closed (off where nothing is to be closed, such as History). */
  closeHint?: boolean;
}) {
  if (job.status === "failed")
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <p className="flex items-center gap-2 font-medium">
          <CircleAlert className="size-4" aria-hidden />
          The PDF could not be created
        </p>
        <p>{job.errorMessage ?? "Try again."}</p>
      </div>
    );
  if (job.status === "succeeded")
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <p role="status" className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="size-4" aria-hidden />
          Your PDF is ready
        </p>
        {ready}
      </div>
    );
  const percent = documentJobPercent(job);
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        {job.status === "queued" ? "PDF queued" : "Creating your PDF"}
      </p>
      <Progress value={percent} aria-label="PDF progress" />
      <p className="text-xs text-muted-foreground">{progressDetail(job)}</p>
      {closeHint ? (
        <p className="text-xs text-muted-foreground">
          You can close this window. The PDF keeps being created and appears in
          Document history.
        </p>
      ) : null}
    </div>
  );
}
