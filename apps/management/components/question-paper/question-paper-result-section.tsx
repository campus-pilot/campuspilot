'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { toast } from '@campuspilot/ui/lib/toast';
import { DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { OptionSelect } from '@campuspilot/components/option-select';
import { ContinueInChatLink } from '@campuspilot/components/question-paper/continue-in-chat-link';
import { hasFigurePlaceholders, MarksSummary } from '@campuspilot/components/question-paper/marks-summary';
import { versionSourceLabel } from '@campuspilot/components/question-paper/question-paper-model';
import { orpc } from '@/lib/orpc';
import { ReadError } from '@/components/exam/exam-common';
import { continueInChatHref, requestErrorMessage, type QuestionPaperScope } from './question-paper-model';
import { useDownloadQuestionPaper, type QuestionPaperDetail } from './use-question-paper-detail';

type ResultProps = {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  versionNo: number | null;
  onSelectVersion: (versionNo: number) => void;
};

function PlaceholderNotice({ href, onNavigate }: { href: string; onNavigate: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
      <p>Some figures are placeholders and need an uploaded image. Add them in chat.</p>
      <ContinueInChatLink href={href} onNavigate={onNavigate} />
    </div>
  );
}

function RenderedVersion({ scope, detail, versionNo }: { scope: QuestionPaperScope; detail: QuestionPaperDetail; versionNo: number }) {
  const router = useRouter();
  const preview = useQuery(orpc.school.getQuestionPaperPreview.queryOptions({ input: { ...scope, versionNo } }));
  const version = detail.versions.find((candidate) => candidate.versionNo === versionNo);
  const chatHref = continueInChatHref(scope);
  // Resolve from held data before the error flag, so a failed refetch never blanks a paper on screen.
  if (preview.data === undefined) {
    return preview.isPending ? <Skeleton className="h-96 w-full rounded-xl" /> : <ReadError error={preview.error} retry={preview.refetch} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <MarksSummary
        totalMarks={null}
        planMaxMarks={version?.planMaxMarks ?? detail.paper.planMaxMarks}
        warnings={preview.data.warnings}
      />
      {hasFigurePlaceholders(preview.data.warnings) ? (
        <PlaceholderNotice href={chatHref} onNavigate={() => router.push(chatHref)} />
      ) : null}
      <DocumentPreview html={preview.data.html} label="Question paper preview" fitPageWidth />
      <ContinueInChatLink href={chatHref} onNavigate={() => router.push(chatHref)} />
    </div>
  );
}

/**
 * One version of the paper as printed: marks against the plan, the sandboxed
 * preview (the same frame as document previews), PDF download and the quiet
 * way into the assistant. The version is the one in the URL, else the latest.
 */
export function QuestionPaperResultSection({ scope, detail, versionNo, onSelectVersion }: ResultProps) {
  const download = useDownloadQuestionPaper();
  const version = detail.versions.find((candidate) => candidate.versionNo === versionNo);
  if (versionNo === null || !version) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No paper has been generated yet. Add photos in Pages and choose Generate with AI.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <OptionSelect
            value={String(versionNo)}
            options={detail.versions.map((candidate) => ({
              value: String(candidate.versionNo),
              label: `Version ${candidate.versionNo}${candidate.isLatest ? ' (latest)' : ''}`,
            }))}
            onValueChange={(value) => onSelectVersion(Number(value))}
            triggerProps={{ 'aria-label': 'Version', className: 'w-44' }}
          />
          <span className="text-xs text-muted-foreground">{versionSourceLabel(version.source)}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={download.isPending}
          onClick={() =>
            download.mutate(
              { ...scope, versionNo },
              { onError: (error) => toast.error(requestErrorMessage(error, 'The PDF could not be prepared.')) },
            )
          }
        >
          <Download aria-hidden /> {download.isPending ? 'Preparing…' : 'Download PDF'}
        </Button>
      </div>
      <RenderedVersion key={versionNo} scope={scope} detail={detail} versionNo={versionNo} />
    </div>
  );
}
