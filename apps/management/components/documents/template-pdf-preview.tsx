'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import { loadPdf, type LoadedPdf } from '@campuspilot/components/documents/pdf-pages';
import { PdfPreview } from '@campuspilot/components/documents/pdf-preview';

import { isClientError, retryUnlessRefused } from '@/components/assistant/assistant-stream';
import { client } from '@/lib/orpc';

import type { DocumentTemplateScope } from './document-common';
import { marketplaceTemplatePreviewInput } from './notice-print-size-preview';

type PageSize = 'full' | 'half';

/** The bytes of a base64 string (the PDF preview procedure's result). */
function bytesOfBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/**
 * A short, stable key for a template source (cyrb53, a 53-bit string hash,
 * plus the length), so the query key does not carry up to 200,000
 * characters that the cache would hash and compare on every render. A
 * collision would need two sources of the same length with the same 53-bit
 * hash while both are in the cache.
 */
function sourceKeyOf(content: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${content.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/**
 * What every template PDF preview query shares. A preview renders the same
 * every time, so each one is converted once (`staleTime: Infinity`) and the
 * cache releases its pdf.js document when it drops the query
 * (`createQueryClient`); a `LoadedPdf` is never compared field by field
 * (`structuralSharing: false`). A template the renderer refuses is a final
 * answer, never retried.
 */
const templatePdfQueryDefaults = {
  staleTime: Number.POSITIVE_INFINITY,
  structuralSharing: false,
  retry: retryUnlessRefused,
} as const;

/** Opens the base64 PDF a preview procedure returns. */
function loadPreviewPdf(result: { pdfBase64: string }): Promise<LoadedPdf> {
  return loadPdf(bytesOfBase64(result.pdfBase64));
}

/**
 * A template source rendered with sample data as the PDF it prints as
 * (`previewDocumentTemplatePdf`), opened with pdf.js, converted once per
 * source (`templatePdfQueryDefaults`). While a newer source converts, the
 * previous pages stay on screen (`keepPreviousData`).
 */
export function useTemplatePdf(input: { scope: DocumentTemplateScope; content: string; pageSize: PageSize; printSize: PageSize }) {
  const { scope, content, pageSize } = input;
  // Only a Notice design is previewed at a print size; every other type uses its footprint.
  const printSize = scope.documentType === 'notice' ? input.printSize : undefined;
  return useQuery({
    queryKey: ['document-template', 'preview-pdf', scope.schoolId, scope.documentType, pageSize, printSize ?? null, sourceKeyOf(content)],
    queryFn: async ({ signal }) =>
      loadPreviewPdf(await client.school.previewDocumentTemplatePdf({ ...scope, content, pageSize, ...(printSize ? { printSize } : {}) }, { signal })),
    ...templatePdfQueryDefaults,
    placeholderData: keepPreviousData,
  });
}

/**
 * A marketplace design rendered with sample data as the PDF it prints as
 * (`previewMarketplaceTemplatePdf`, by slug: the client never downloads the
 * design's source to preview it), converted once per design and print size
 * (`templatePdfQueryDefaults`; the server converts each design once too).
 * Unlike the editor's preview it keeps no previous data: another design's
 * pages must never stand in for the one asked for, so a design not yet
 * converted shows the page-shaped skeleton.
 */
export function useMarketplaceTemplatePdf(input: { scope: DocumentTemplateScope; slug: string; printSize: PageSize }) {
  const request = marketplaceTemplatePreviewInput(input.scope, input.slug, input.printSize);
  return useQuery({
    queryKey: ['document-template', 'marketplace-pdf', request.schoolId, request.documentType, request.slug, request.printSize ?? null],
    queryFn: async ({ signal }) => loadPreviewPdf(await client.school.previewMarketplaceTemplatePdf(request, { signal })),
    ...templatePdfQueryDefaults,
  });
}

/** What a failed preview says: the renderer's own reason for a template it refuses, else a sentence of ours. */
function previewErrorOf(error: unknown): string {
  if (isClientError(error) && error instanceof Error && error.message) return error.message;
  return 'The preview could not be made. Check your connection and try again.';
}

/** The page shape a type's skeleton draws: a timetable prints on landscape A4. */
function orientationOf(documentType: DocumentType) {
  return documentType === 'timetable' ? 'landscape' : 'portrait';
}

/** A template PDF query on screen: its pages, the updating badge, and a failure with Try again. */
function TemplatePdfQueryPreview({ pdf, documentType, label }: { pdf: UseQueryResult<LoadedPdf, unknown>; documentType: DocumentType; label: string }) {
  return (
    <PdfPreview
      pdf={pdf.data ?? null}
      label={label}
      orientation={orientationOf(documentType)}
      updating={pdf.isFetching}
      error={pdf.isError ? previewErrorOf(pdf.error) : null}
      onRetry={() => void pdf.refetch()}
    />
  );
}

/**
 * A template's preview with sample data, as its PDF pages (`PdfPreview`, the
 * question paper studio's viewer). It takes its container's height.
 */
export function TemplatePdfPreview({
  scope,
  content,
  pageSize,
  printSize,
  label,
}: {
  scope: DocumentTemplateScope;
  content: string;
  pageSize: PageSize;
  /** Notice designs only: the notice print size to preview at. */
  printSize: PageSize;
  label: string;
}) {
  const pdf = useTemplatePdf({ scope, content, pageSize, printSize });
  return <TemplatePdfQueryPreview pdf={pdf} documentType={scope.documentType} label={label} />;
}

/**
 * A marketplace design's preview with sample data, as its PDF pages. It
 * takes its container's height (the marketplace's preview frame, or the
 * full-screen preview dialog, which shows the same cached conversion).
 */
export function MarketplaceTemplatePdfPreview({
  scope,
  slug,
  printSize,
  label,
}: {
  scope: DocumentTemplateScope;
  slug: string;
  /** Notice designs only: the notice print size to preview at. */
  printSize: PageSize;
  label: string;
}) {
  const pdf = useMarketplaceTemplatePdf({ scope, slug, printSize });
  return <TemplatePdfQueryPreview pdf={pdf} documentType={scope.documentType} label={label} />;
}
