'use client';

import {
  documentTypeSchema,
  isFinanceDocumentType,
  type DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import type { AssistantDocumentsView } from '@campuspilot/assistant-contract/views';
import { AssistantRecordList, type AssistantRecord } from '@campuspilot/components/assistant';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { useMutation } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';

import { client } from '@/lib/orpc';

/** "report_card" as "Report card". */
function documentTypeLabel(type: DocumentType) {
  const words = type.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The document type the assistant named, when the chat may offer it. Bills,
 * receipts and statements are money documents, which the assistant does not
 * handle, so a view naming one shows it as unavailable.
 */
function offeredDocumentType(value: string): DocumentType | null {
  const parsed = documentTypeSchema.safeParse(value);
  return parsed.success && !isFinanceDocumentType(parsed.data) ? parsed.data : null;
}

/**
 * Fetches a fresh download link with the user's own session and opens it.
 * The link is asked for on click, never stored: it expires in minutes.
 */
function DocumentDownload({
  schoolId,
  artifactId,
  documentType,
  name,
}: {
  schoolId: string;
  artifactId: string;
  documentType: DocumentType;
  name: string;
}) {
  const download = useMutation({
    mutationFn: async () => {
      const { url } = await client.school.getDocumentDownload({ schoolId, artifactId, documentType });
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noopener noreferrer';
      link.click();
    },
  });
  return (
    <span className="flex shrink-0 items-center gap-2">
      {download.isError ? (
        <span role="alert" className="text-xs text-destructive">
          Couldn’t download
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={download.isPending}
        aria-label={`Download ${name}`}
        onClick={() => download.mutate()}
      >
        {download.isPending ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" aria-hidden />}
        {download.isError ? 'Try again' : 'Download'}
      </Button>
    </span>
  );
}

function DocumentTile() {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <FileText className="size-4" aria-hidden />
    </span>
  );
}

/** Documents the assistant generated or found, each with its own Download button. */
export function AssistantDocumentsViewBlock({ schoolId, view }: { schoolId: string; view: AssistantDocumentsView }) {
  const records = view.documents.flatMap((document): AssistantRecord[] => {
    const documentType = offeredDocumentType(document.documentType);
    if (!documentType) return [];
    return [
      {
        id: document.artifactId,
        leading: <DocumentTile />,
        title: document.name,
        subtitle: document.detail ?? documentTypeLabel(documentType),
        action: (
          <DocumentDownload
            schoolId={schoolId}
            artifactId={document.artifactId}
            documentType={documentType}
            name={document.name}
          />
        ),
      },
    ];
  });
  return (
    <AssistantRecordList
      title={view.title}
      records={records}
      unavailable={view.documents.length - records.length}
      renderLink={() => null}
    />
  );
}
