'use client';

import { useState } from 'react';
import { ORPCError } from '@orpc/client';
import { keepPreviousData, skipToken, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import { loadPdf, type LoadedPdf } from '@campuspilot/components/documents/pdf-pages';
import { PdfPreview } from '@campuspilot/components/documents/pdf-preview';

import { isClientError } from '@/components/assistant/assistant-stream';
import { useStoredSchoolSessionId } from '@/components/session-selection';
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

/** How many times a preview the server turned away as busy is asked again (see {@link retryWhenBusy}). */
const BUSY_RETRIES = 3;

/**
 * A preview is asked again only when the server said this person already
 * has several previews being made (TOO_MANY_REQUESTS, docs/document-system.md
 * "Preview limits"), which frees up within seconds. Everything else is final
 * until the person presses Try again: a refused template gives the same
 * answer again, and a conversion that failed or ran out of time (each one a
 * Chromium conversion) must not be repeated behind their back.
 */
function retryWhenBusy(failureCount: number, error: unknown): boolean {
  return failureCount < BUSY_RETRIES && error instanceof ORPCError && error.code === 'TOO_MANY_REQUESTS';
}

/**
 * What every template PDF preview query shares. A preview renders the same
 * every time, so each one is converted once (`staleTime: Infinity`); a
 * `LoadedPdf` is never compared field by field (`structuralSharing: false`).
 * The cache releases a document soon after nothing asks for it (`gcTime`,
 * then `createQueryClient` calls its `release`), so typing does not pile up
 * parsed PDFs; a document still on screen (a previous render kept while the
 * next converts, or after it failed) is never destroyed by that, because the
 * viewer holds it too (`LoadedPdf.retain`).
 */
const templatePdfQueryDefaults = {
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: 30_000,
  structuralSharing: false,
  retry: retryWhenBusy,
  retryDelay: (attempt: number) => 1_000 * 2 ** attempt,
} as const;

/**
 * The session whose data a template preview shows: the one selected in the
 * sidebar's session switcher, as every school page stores it. When none is
 * stored, nothing is sent and the server uses the school's active session,
 * else its latest: the same session the switcher then shows. Previews are
 * rendered with the school's own data where the person may read it
 * (docs/document-system.md, "Preview context"), so the session is part of
 * every preview's query key.
 */
function usePreviewSessionId(schoolId: string): string | undefined {
  return useStoredSchoolSessionId(schoolId);
}

/** Opens the base64 PDF a preview procedure returns; a document opened after the query was cancelled is freed (`loadPdf`). */
function loadPreviewPdf(result: { pdfBase64: string }, signal: AbortSignal): Promise<LoadedPdf> {
  return loadPdf(bytesOfBase64(result.pdfBase64), signal);
}

/**
 * A template source rendered with the school's data as the PDF it prints as
 * (`previewDocumentTemplatePdf`, for those who may change the template),
 * opened with pdf.js, converted once per source (`templatePdfQueryDefaults`).
 * While a newer source converts, the previous pages stay on screen
 * (`keepPreviousData`).
 */
export function useTemplatePdf(input: { scope: DocumentTemplateScope; content: string; pageSize: PageSize; printSize: PageSize }) {
  const { scope, content, pageSize } = input;
  // Only a Notice design is previewed at a print size; every other type uses its footprint.
  const printSize = scope.documentType === 'notice' ? input.printSize : undefined;
  const sessionId = usePreviewSessionId(scope.schoolId);
  return useQuery({
    queryKey: ['document-template', 'preview-pdf', scope.schoolId, scope.documentType, sessionId ?? null, pageSize, printSize ?? null, sourceKeyOf(content)],
    queryFn: async ({ signal }) =>
      loadPreviewPdf(
        await client.school.previewDocumentTemplatePdf(
          { ...scope, content, pageSize, ...(printSize ? { printSize } : {}), ...(sessionId ? { sessionId } : {}) },
          { signal },
        ),
        signal,
      ),
    ...templatePdfQueryDefaults,
    placeholderData: keepPreviousData,
  });
}

/**
 * A saved revision rendered with the school's data as the PDF it prints as, by its
 * id (`previewDocumentTemplateRevisionPdf`, the template read gate): the
 * read-only template page and the builder's revision view. A revision never
 * changes, so it converts once per print size; like the marketplace it keeps
 * no previous data, so another revision's pages never stand in for it.
 */
export function useTemplateRevisionPdf(input: { scope: DocumentTemplateScope; revisionId: string | null; printSize: PageSize }) {
  const { scope, revisionId } = input;
  const printSize = scope.documentType === 'notice' ? input.printSize : undefined;
  const sessionId = usePreviewSessionId(scope.schoolId);
  return useQuery({
    queryKey: ['document-template', 'revision-pdf', scope.schoolId, scope.documentType, sessionId ?? null, revisionId, printSize ?? null],
    queryFn: revisionId
      ? async ({ signal }) =>
          loadPreviewPdf(
            await client.school.previewDocumentTemplateRevisionPdf(
              { ...scope, revisionId, ...(printSize ? { printSize } : {}), ...(sessionId ? { sessionId } : {}) },
              { signal },
            ),
            signal,
          )
      : skipToken,
    ...templatePdfQueryDefaults,
  });
}

/**
 * A marketplace design rendered with the school's data as the PDF it prints
 * as (`previewMarketplaceTemplatePdf`, by slug: the client never downloads
 * the design's source to preview it), converted once per design, session and
 * print size (`templatePdfQueryDefaults`; the server converts every request,
 * since each renders the school's data as the person may read it).
 * Unlike the editor's preview it keeps no previous data: another design's
 * pages must never stand in for the one asked for, so a design not yet
 * converted shows the page-shaped skeleton.
 */
export function useMarketplaceTemplatePdf(input: { scope: DocumentTemplateScope; slug: string; printSize: PageSize }) {
  const sessionId = usePreviewSessionId(input.scope.schoolId);
  const request = marketplaceTemplatePreviewInput(input.scope, input.slug, input.printSize, sessionId);
  return useQuery({
    queryKey: ['document-template', 'marketplace-pdf', request.schoolId, request.documentType, sessionId ?? null, request.slug, request.printSize ?? null],
    queryFn: async ({ signal }) => loadPreviewPdf(await client.school.previewMarketplaceTemplatePdf(request, { signal }), signal),
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

/**
 * The document a preview shows: the query's own (or, while a newer one
 * converts, its placeholder), else, when `keepOnError` and the latest render
 * failed, the last document that rendered, so a failure is said over the
 * last good pages instead of blanking them (TanStack Query drops the
 * placeholder once a query fails). The last good document is remembered by
 * setting state during render, React's pattern for keeping information from
 * earlier renders, not in an effect. It was on screen without a break until
 * now, so its viewer still holds it (`LoadedPdf.retain`).
 */
function useShownPdf(query: UseQueryResult<LoadedPdf, unknown>, keepOnError: boolean): LoadedPdf | null {
  const [lastGood, setLastGood] = useState<LoadedPdf | null>(null);
  if (query.isSuccess && !query.isPlaceholderData && query.data !== lastGood) setLastGood(query.data);
  if (query.data) return query.data;
  return keepOnError && query.isError ? lastGood : null;
}

/** A template PDF query on screen: its pages, the updating badge, and a failure with Try again. */
function TemplatePdfQueryPreview({
  pdf,
  documentType,
  label,
  keepOnError,
}: {
  pdf: UseQueryResult<LoadedPdf, unknown>;
  documentType: DocumentType;
  label: string;
  /** Keep the last good pages under a failure (the editor's own source; never another design or revision). */
  keepOnError: boolean;
}) {
  const shown = useShownPdf(pdf, keepOnError);
  return (
    <PdfPreview
      pdf={shown}
      label={label}
      orientation={orientationOf(documentType)}
      updating={pdf.isFetching}
      error={pdf.isError ? previewErrorOf(pdf.error) : null}
      onRetry={() => void pdf.refetch()}
    />
  );
}

/**
 * A template's preview with the school's data, as its PDF pages (`PdfPreview`, the
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
  return <TemplatePdfQueryPreview pdf={pdf} documentType={scope.documentType} label={label} keepOnError />;
}

/**
 * A marketplace design's preview with the school's data, as its PDF pages. It
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
  return <TemplatePdfQueryPreview pdf={pdf} documentType={scope.documentType} label={label} keepOnError={false} />;
}

/**
 * A saved revision's preview with the school's data, as its PDF pages, by its id
 * (the read-only template page and the builder's revision view). It takes
 * its container's height.
 */
export function TemplateRevisionPdfPreview({
  scope,
  revisionId,
  printSize,
  label,
}: {
  scope: DocumentTemplateScope;
  revisionId: string;
  /** Notice designs only: the notice print size to preview at. */
  printSize: PageSize;
  label: string;
}) {
  const pdf = useTemplateRevisionPdf({ scope, revisionId, printSize });
  return <TemplatePdfQueryPreview pdf={pdf} documentType={scope.documentType} label={label} keepOnError={false} />;
}
