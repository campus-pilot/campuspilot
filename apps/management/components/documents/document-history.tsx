'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { FileText, Trash2, RefreshCw } from 'lucide-react';
import {
  DocumentButton,
  DocumentField,
  DocumentNotice,
  DocumentPanel,
} from '@campuspilot/components/documents/document-controls';
import type {
  DocumentArtifact,
  DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
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
export function DocumentHistory({
  scope,
  documentType,
}: {
  scope: DocumentScope;
  documentType: DocumentType;
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
            documentType={documentType}
            search={values.search}
            page={values.page}
            onPage={(page) => form.setFieldValue('page', page)}
          />
        )}
      </form.Subscribe>
    </DocumentPanel>
  );
}
function HistoryRows({
  scope,
  documentType,
  search,
  page,
  onPage,
}: {
  scope: DocumentScope;
  documentType: DocumentType;
  search: string;
  page: number;
  onPage: (value: number) => void;
}) {
  const history = useQuery(
    orpc.school.listDocumentArtifacts.queryOptions({
      input: {
        schoolId: scope.schoolId,
        filters: { documentType, sessionId: scope.sessionId },
        searchQuery: search,
        page,
      },
    }),
  );
  if (history.isPending) return <DocumentLoading />;
  if (history.isError)
    return <DocumentReadError error={history.error} retry={history.refetch} />;
  return (
    <div className="flex flex-col gap-4">
      {history.data.items.length ? (
        history.data.items.map((artifact) => (
          <ArtifactRow key={artifact.id} artifact={artifact} />
        ))
      ) : (
        <DocumentNotice>
          {search
            ? 'No documents match your search.'
            : 'No PDFs yet. Create your first document from the Create document tab.'}
        </DocumentNotice>
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
function ArtifactRow({ artifact }: { artifact: DocumentArtifact }) {
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
          <DocumentDownload
            schoolId={artifact.schoolId}
            artifactId={artifact.id}
          />
        )}
        <DocumentPermission
          schoolId={artifact.schoolId}
          action={SCHOOL_ACTIONS.DELETE_DOCUMENT_ARTIFACTS}
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
        Template: {artifact.templateName ?? 'Saved school template'}
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
          {confirming ? (
            <>
              <p className="text-sm">
                Delete this PDF from document history and storage?
              </p>
              <div className="flex gap-2">
                <DocumentButton
                  variant="destructive"
                  disabled={submitting || !canSubmit}
                  onClick={() => void form.handleSubmit()}
                >
                  {submitting ? 'Deleting…' : 'Delete PDF'}
                </DocumentButton>
                <DocumentButton
                  variant="ghost"
                  disabled={submitting}
                  onClick={() => form.setFieldValue('confirming', false)}
                >
                  Cancel
                </DocumentButton>
              </div>
            </>
          ) : (
            <DocumentButton
              variant="ghost"
              onClick={() => form.setFieldValue('confirming', true)}
            >
              {artifact.status === 'deleting' ? <RefreshCw /> : <Trash2 />}
              {artifact.status === 'deleting' ? 'Retry deletion' : 'Delete'}
            </DocumentButton>
          )}
          {error && <DocumentNotice error>{error}</DocumentNotice>}
        </div>
      )}
    </form.Subscribe>
  );
}
