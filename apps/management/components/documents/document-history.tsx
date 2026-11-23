'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { FilePlus, FileText, Trash2, RefreshCw } from 'lucide-react';
import {
  DocumentButton,
  DocumentField,
  DocumentNotice,
  DocumentPanel,
} from '@campuspilot/components/documents/document-controls';
import {
  DOCUMENT_LABELS,
  type DocumentArtifact,
  type DocumentGenerationJobDto,
} from '@campuspilot/api/routers/school/document/document.dto';
import { DocumentJobProgress } from '@campuspilot/components/documents/document-job-progress';
import { client, orpc } from '@/lib/orpc';
import {
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  SCHOOL_ACTIONS,
  useDocumentCache,
  type DocumentScope,
} from './document-common';
import { DocumentDownload } from './document-generator';
/** History is intentionally session-wide across document types. Type and
 * immutable template provenance are attributes of each row, not a prerequisite
 * filter the user must choose before seeing their documents.
 */
export function DocumentHistory({
  scope,
  domains,
  onCreate,
}: {
  scope: DocumentScope;
  domains: { academic: boolean; finance: boolean };
  /** Opens the New section; passed only to people who can read a template there. */
  onCreate?: () => void;
}) {
  const form = useForm({
    defaultValues: { search: '', page: 1 },
    validators: {
      onChange: z.object({
        search: z.string().max(100),
        page: z.number().int().positive(),
      }),
    },
  });
  return (
    <DocumentPanel
      title="Document history"
      description="Generated PDFs for this academic session. Each export keeps the template revision used to create it."
    >
      <form.Field name="search">
        {(field) => (
          <DocumentField
            field={{
              name: field.name,
              state: field.state,
              handleBlur: field.handleBlur,
              handleChange: (value) => {
                field.handleChange(value);
                form.setFieldValue('page', 1);
              },
            }}
            label="Search documents"
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <HistoryRows
            scope={scope}
            domains={domains}
            search={values.search}
            page={values.page}
            onPage={(page) => form.setFieldValue('page', page)}
            onCreate={onCreate}
          />
        )}
      </form.Subscribe>
    </DocumentPanel>
  );
}
/** The session has no PDFs yet; people who can create one get a button to the New section. */
function NoDocumentsYet({ onCreate }: { onCreate?: () => void }) {
  if (!onCreate) return <DocumentNotice>No PDFs yet.</DocumentNotice>;
  return (
    <div className="flex flex-col gap-3">
      <DocumentNotice>No PDFs yet. Create your first document from the New tab.</DocumentNotice>
      <div>
        <DocumentButton variant="outline" onClick={onCreate}>
          <FilePlus aria-hidden />
          Create a document
        </DocumentButton>
      </div>
    </div>
  );
}
function HistoryRows({
  scope,
  domains,
  search,
  page,
  onPage,
  onCreate,
}: {
  scope: DocumentScope;
  domains: { academic: boolean; finance: boolean };
  onCreate?: () => void;
  search: string;
  page: number;
  onPage: (value: number) => void;
}) {
  const documentDomain =
    domains.academic && domains.finance
      ? 'all'
      : domains.finance
        ? 'finance'
        : 'academic';
  // PDFs still being created, and recent failures with their reason. While
  // any is in progress both lists are read again every few seconds, so a
  // finished job moves from here into the PDF list (no effect involved).
  const jobs = useQuery({
    ...orpc.school.listDocumentGenerationJobs.queryOptions({
      input: { schoolId: scope.schoolId, sessionId: scope.sessionId, documentDomain },
    }),
    refetchInterval: (query) => (hasActiveJob(query.state.data?.items) ? JOB_POLL_MS : false),
  });
  const history = useQuery({
    ...orpc.school.listDocumentArtifacts.queryOptions({
      input: {
        schoolId: scope.schoolId,
        filters: { sessionId: scope.sessionId, documentDomain },
        searchQuery: search,
        page,
      },
    }),
    refetchInterval: hasActiveJob(jobs.data?.items) ? JOB_POLL_MS : false,
  });
  if (history.isPending) return <DocumentLoading />;
  if (history.isError)
    return <DocumentReadError error={history.error} retry={history.refetch} />;
  return (
    <div className="flex flex-col gap-4">
      {jobs.isError ? <DocumentReadError error={jobs.error} retry={jobs.refetch} /> : null}
      {jobs.data?.items.map((job) => <JobRow key={job.id} job={job} />)}
      {history.data.items.length ? (
        history.data.items.map((artifact) => (
          <ArtifactRow key={artifact.id} artifact={artifact} />
        ))
      ) : search ? (
        <DocumentNotice>No documents match your search.</DocumentNotice>
      ) : (
        <NoDocumentsYet onCreate={onCreate} />
      )}
      <nav
        aria-label="Document history pages"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-xs text-muted-foreground">
          {history.data.pagination.totalItems} documents · Page {page} of{' '}
          {Math.max(1, history.data.pagination.totalPages)}
        </p>
        <div className="flex gap-2">
          <DocumentButton
            variant="outline"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </DocumentButton>
          <DocumentButton
            variant="outline"
            disabled={!history.data.pagination.nextCursor}
            onClick={() => onPage(page + 1)}
          >
            Next
          </DocumentButton>
        </div>
      </nav>
    </div>
  );
}
/** How often History reads its lists again while a PDF is being created. */
const JOB_POLL_MS = 3_000;
const hasActiveJob = (items: DocumentGenerationJobDto[] | undefined) =>
  Boolean(items?.some((job) => job.status === 'queued' || job.status === 'running'));
/** A PDF being created (with its progress) or one that failed (with the reason). */
function JobRow({ job }: { job: DocumentGenerationJobDto }) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="rounded-lg bg-muted p-3 text-muted-foreground">
          <FileText className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="break-words text-sm font-semibold">{job.name}</h3>
          <p className="text-xs text-muted-foreground">
            {DOCUMENT_LABELS[job.documentType]} · requested{' '}
            {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(job.createdAt))}
          </p>
        </div>
      </div>
      <DocumentJobProgress job={job} closeHint={false} />
    </article>
  );
}
function ArtifactRow({ artifact }: { artifact: DocumentArtifact }) {
  const finance =
    artifact.documentType === 'bill' ||
    artifact.documentType === 'receipt' ||
    artifact.documentType === 'statement';
  const readAction = finance
    ? SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS
    : SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS;
  const deleteAction = finance
    ? SCHOOL_ACTIONS.DELETE_FINANCE_DOCUMENT_ARTIFACTS
    : SCHOOL_ACTIONS.DELETE_DOCUMENT_ARTIFACTS;
  return (
    <article className="flex flex-col gap-4 rounded-xl border p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="rounded-lg bg-muted p-3 text-muted-foreground">
          <FileText className="size-5" />
        </span>
        <ArtifactDetails artifact={artifact} />
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {artifact.status === 'ready' && (
          <DocumentPermission schoolId={artifact.schoolId} action={readAction}>
            <DocumentDownload
              schoolId={artifact.schoolId}
              artifactId={artifact.id}
              documentType={artifact.documentType}
            />
          </DocumentPermission>
        )}
        <DocumentPermission
          schoolId={artifact.schoolId}
          action={deleteAction}
        >
          <DeleteArtifact artifact={artifact} />
        </DocumentPermission>
      </div>
    </article>
  );
}
function ArtifactDetails({ artifact }: { artifact: DocumentArtifact }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="break-words text-sm font-semibold">{artifact.name}</h3>
      <p className="text-xs text-muted-foreground">
        {new Intl.DateTimeFormat('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(artifact.createdAt))}{' '}
        · {Math.max(1, Math.round(artifact.byteSize / 1024))} KB
        {artifact.studentCount > 0 && ` · ${artifact.studentCount} students`}
      </p>
      <p className="text-xs text-muted-foreground">
        {DOCUMENT_LABELS[artifact.documentType]} · Template:{' '}
        {artifact.templateName ?? 'Saved school template'}
      </p>
      {artifact.status === 'deleting' && (
        <p className="text-xs text-destructive">
          Removal was interrupted. Retry to finish deleting this PDF.
        </p>
      )}
    </div>
  );
}
function DeleteArtifact({ artifact }: { artifact: DocumentArtifact }) {
  const cache = useDocumentCache();
  const form = useForm({
    defaultValues: { confirming: false, error: '' },
    validators: {
      onChange: z.object({ confirming: z.boolean(), error: z.string() }),
    },
    onSubmit: async () => {
      form.setFieldValue('error', '');
      try {
        await client.school.deleteDocumentArtifact({
          schoolId: artifact.schoolId,
          artifactId: artifact.id,
          documentType: artifact.documentType,
        });
        await cache.artifacts(artifact.schoolId);
      } catch (error) {
        form.setFieldValue(
          'error',
          error instanceof Error
            ? error.message
            : 'Deletion failed. Retry to finish removing this document.',
        );
        await cache.artifacts(artifact.schoolId);
      }
    },
  });
  return (
    <form.Subscribe
      selector={(state) => ({
        ...state.values,
        submitting: state.isSubmitting,
        canSubmit: state.canSubmit,
      })}
    >
      {({ confirming, error, submitting, canSubmit }) => (
        <div className="flex max-w-sm flex-col gap-3">
          <DocumentButton
            variant="ghost"
            onClick={() => form.setFieldValue('confirming', true)}
          >
            {artifact.status === 'deleting' ? <RefreshCw /> : <Trash2 />}
            {artifact.status === 'deleting' ? 'Retry deletion' : 'Delete'}
          </DocumentButton>
          <ConfirmationDialog
            open={confirming}
            title="Delete PDF?"
            description="This removes the PDF from document history and storage. Saved templates and examination records remain available."
            confirmLabel={submitting ? 'Deleting…' : 'Delete PDF'}
            pending={submitting}
            onOpenChange={(open) => form.setFieldValue('confirming', open)}
            onConfirm={() => {
              if (canSubmit) void form.handleSubmit();
            }}
          />
          {error && <DocumentNotice error>{error}</DocumentNotice>}
        </div>
      )}
    </form.Subscribe>
  );
}
