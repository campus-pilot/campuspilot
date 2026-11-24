"use client";

import { ArrowRight, Eye } from "lucide-react";
import type { DocumentGenerationJobDto } from "@campuspilot/api/routers/school/document/document.dto";
import {
  DocumentButton,
  DocumentNotice,
  DocumentPreview,
} from "@campuspilot/components/documents/document-controls";
import { RequirePermissions } from "@/components/require-permissions";
import { SCHOOL_ACTIONS, documentPermission, type DocumentScope } from "./document-common";
import { CreatePdfButton, DocumentDownload } from "./document-generator";
import { DocumentJobTracker } from "./document-job";

/** What the preview panel shows for the selection on screen (see {@link FinancePreviewPanel}). */
export type FinancePanelState = {
  /** Whether the selection is complete enough to preview or create. */
  ready: boolean;
  /** The current selection's preview, or null when there is none for it. */
  preview: { html: string; warnings: string[]; recipientCount: number; sampleCount: number } | null;
  /** The job started for the current selection, or null. */
  job: DocumentGenerationJobDto | null;
  error: string;
  submitting: boolean;
  mode: "preview" | "generate";
  canSubmit: boolean;
};

/**
 * The finance generators' preview and create panel: warnings, the error, the
 * Create PDF and Preview actions, the preview and the job's progress with its
 * download. Presentational: the caller's form owns the state and the calls,
 * so the Billing cycles, Receipts and By date (Bill due) generators share it.
 */
export function FinancePreviewPanel({
  state,
  documentType,
  documentsLabel,
  scope,
  onPreview,
  onCreate,
  onHistory,
}: {
  state: FinancePanelState;
  documentType: "bill" | "receipt" | "bill_due";
  /** The documents counted in the preview's summary ("bills", "receipts"). */
  documentsLabel: string;
  scope: DocumentScope;
  onPreview: () => void;
  onCreate: () => void;
  onHistory: () => void;
}) {
  const blocked = !state.ready || state.submitting || !state.canSubmit;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {state.preview?.warnings.map((warning) => (
        <DocumentNotice key={warning}>{warning}</DocumentNotice>
      ))}
      {state.error ? <DocumentNotice error>{state.error}</DocumentNotice> : null}
      <div className="flex flex-wrap gap-2">
        <CreatePdfButton disabled={blocked} running={state.submitting && state.mode === "generate"} onCreate={onCreate} />
        <DocumentButton variant="outline" disabled={blocked} onClick={onPreview}>
          <Eye />
          {state.submitting && state.mode === "preview" ? "Preparing preview…" : "Preview document"}
        </DocumentButton>
      </div>
      {state.preview ? (
        <p className="text-xs text-muted-foreground">
          The PDF will contain {state.preview.recipientCount.toLocaleString("en-IN")} {documentsLabel}
          {state.preview.sampleCount < state.preview.recipientCount
            ? `; the preview shows the first ${state.preview.sampleCount}`
            : ""}
          .
        </p>
      ) : null}
      <DocumentPreview html={state.preview?.html} />
      {state.job ? (
        <DocumentJobTracker
          key={state.job.id}
          schoolId={scope.schoolId}
          job={state.job}
          ready={(artifactId) => (
            <RequirePermissions
              permissions={documentPermission(scope.schoolId, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS)}
              fallback={<DocumentNotice>The PDF was created, but your account cannot download finance documents.</DocumentNotice>}
            >
              <DocumentDownload schoolId={scope.schoolId} artifactId={artifactId} documentType={documentType} />
              <DocumentButton variant="ghost" onClick={onHistory}>
                View document history <ArrowRight />
              </DocumentButton>
            </RequirePermissions>
          )}
        />
      ) : null}
    </section>
  );
}
