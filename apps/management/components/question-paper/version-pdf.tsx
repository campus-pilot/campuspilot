'use client';

import { loadPdf, PdfPages } from '@campuspilot/components/documents/pdf-pages';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';

import { retryUnlessRefused } from '@/components/assistant/assistant-stream';
import { ReadError } from '@/components/exam/exam-common';
import { fetchQuestionPaperVersionPdf } from '@/lib/question-paper-pages';

import type { QuestionPaperScope } from './question-paper-model';

/**
 * A saved version's PDF, opened with pdf.js. A version never changes, so it
 * is read once (`staleTime: Infinity`) and never refetched in place, which
 * would orphan the open document; the query client releases the document
 * when the cache drops it (`createQueryClient`). The data is not plain
 * JSON, so structural sharing is off.
 */
function useVersionPdf(scope: QuestionPaperScope, versionNo: number) {
  return useQuery({
    queryKey: ['question-paper', 'version-pdf', scope.schoolId, scope.sessionId, scope.examSlug, scope.classId, scope.subjectSlug, scope.modeSlug, versionNo],
    queryFn: async ({ signal }) => loadPdf(await fetchQuestionPaperVersionPdf(scope, versionNo, signal)),
    staleTime: Number.POSITIVE_INFINITY,
    structuralSharing: false,
    retry: retryUnlessRefused,
  });
}

/**
 * A saved version as its PDF: the very file Download PDF gives, page by page,
 * so what is on screen has the printed page breaks. It takes its container's
 * height.
 */
export function VersionPdf({ scope, versionNo }: { scope: QuestionPaperScope; versionNo: number }) {
  const pdf = useVersionPdf(scope, versionNo);
  if (pdf.data) return <PdfPages pdf={pdf.data} label={`Version ${versionNo} as printed`} />;
  if (pdf.isPending) return <Skeleton className="h-full w-full rounded-xl" />;
  return <ReadError error={pdf.error} retry={pdf.refetch} />;
}
