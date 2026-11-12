'use client';

import { CLASS_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import type { AssistantQuestionPaperView } from '@campuspilot/assistant-contract/views';
import { AssistantViewFrame } from '@campuspilot/components/assistant';
import { DocumentPreview } from '@campuspilot/components/documents/document-controls';
import {
  draftFactsOf,
  parseDraftCallInput,
  parseStoredDraftResult,
  saveDraftMessage,
  type DraftResult,
} from '@campuspilot/components/question-paper/chat-cards-model';
import { PlaceholderNote, RemovedList } from '@campuspilot/components/question-paper/paper-notices';
import { QuestionPaperDraftCard, QuestionPaperVersionCard } from '@campuspilot/components/question-paper/chat-cards';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@campuspilot/ui/components/dialog';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { toast } from '@campuspilot/ui/lib/toast';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import type { ReactNode } from 'react';

import { RequirePermissions } from '@/components/require-permissions';
import { useDownloadQuestionPaper } from '@/components/question-paper/use-question-paper-detail';
import { requestErrorMessage } from '@/components/question-paper/question-paper-model';
import { client, orpc } from '@/lib/orpc';

import { retryUnlessRefused } from './assistant-stream';

/** A Preview button that opens the paper in a dialog; the dialog's body loads only while it is open. */
function PreviewDialog({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Eye data-icon="inline-start" aria-hidden /> Preview
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function PreviewMessage({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

type DraftInput = NonNullable<ReturnType<typeof parseDraftCallInput>>;

/**
 * The draft rendered with the school's currently selected template. Cached by
 * the paper key and the draft's id (a hash of its content only): the heading
 * names the class, subject and exam, so identical content for another paper
 * is a different render. The server reads the stored input, never the model.
 */
function DraftPreviewBody({ schoolId, input, draftId }: { schoolId: string; input: DraftInput; draftId: string }) {
  const preview = useQuery({
    queryKey: [
      'assistant',
      'question-paper-draft-preview',
      schoolId,
      input.sessionId,
      input.examSlug,
      input.classId,
      input.subjectSlug,
      input.modeSlug,
      draftId,
    ],
    queryFn: () => client.school.previewQuestionPaperDraft(input),
    staleTime: Number.POSITIVE_INFINITY,
    retry: retryUnlessRefused,
  });
  if (preview.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (preview.isError) return <PreviewMessage>{requestErrorMessage(preview.error, 'The draft could not be previewed.')}</PreviewMessage>;
  if (preview.data.problems.length > 0) return <PreviewMessage>{preview.data.problems[0]}</PreviewMessage>;
  return <DocumentPreview html={preview.data.html} label="Draft preview" fitPageWidth />;
}

/**
 * The result of a draft check: what the call stored when it can be trusted,
 * otherwise the stored input checked again with the user's own session (the
 * display copy of an output is cut at 4,000 characters).
 */
function useDraftResult(call: AssistantToolCallItemDto, input: DraftInput | null): DraftResult | null {
  const stored = parseStoredDraftResult(call.body.output, call.body.outputTruncated);
  const recheck = useQuery({
    queryKey: ['assistant', 'question-paper-draft-check', call.id],
    queryFn: () => client.school.validateQuestionPaperDraft(input!),
    enabled: !stored && Boolean(input),
    staleTime: Number.POSITIVE_INFINITY,
    retry: retryUnlessRefused,
  });
  return stored ?? recheck.data ?? null;
}

/**
 * A draft question paper the assistant wrote (a `validateQuestionPaperDraft`
 * call). It is a draft until the user says so: Preview renders it, and Save as
 * new version sends the message that asks for it (decision D32), after which
 * the usual approval card follows.
 */
export function AssistantDraftCard({
  schoolId,
  call,
  ordinal,
  onSendMessage,
  saveRequested,
}: {
  schoolId: string;
  call: AssistantToolCallItemDto;
  ordinal: number;
  /** Whether the conversation already holds the user's message that saves this draft (by draft id). */
  saveRequested: (draftId: string) => boolean;
  /** Sends a chat message; absent while the chat cannot send. */
  onSendMessage?: (text: string) => void;
}) {
  const input = parseDraftCallInput(call.body.input);
  const result = useDraftResult(call, input);
  if (!input || !result) {
    return (
      <AssistantViewFrame title={`Draft ${ordinal}`}>
        {input ? <Skeleton className="h-24 w-full rounded-xl" /> : <PreviewMessage>This draft can’t be shown.</PreviewMessage>}
      </AssistantViewFrame>
    );
  }
  const facts = draftFactsOf(result);
  return (
    <QuestionPaperDraftCard
      ordinal={ordinal}
      {...facts}
      preview={
        facts.valid ? (
          <PreviewDialog title={`Draft ${ordinal}`} description="How this draft prints with your school’s template. Nothing is saved.">
            <DraftPreviewBody schoolId={schoolId} input={input} draftId={facts.draftId} />
          </PreviewDialog>
        ) : null
      }
      saveRequested={facts.valid && saveRequested(facts.draftId)}
      onSave={facts.valid && onSendMessage ? () => onSendMessage(saveDraftMessage(facts.draftId)) : undefined}
    />
  );
}

function VersionPreviewBody({ view, schoolId }: { view: AssistantQuestionPaperView; schoolId: string }) {
  const preview = useQuery({
    ...orpc.school.getQuestionPaperPreview.queryOptions({ input: { ...view, schoolId } }),
    retry: retryUnlessRefused,
  });
  if (preview.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (preview.isError) return <PreviewMessage>{requestErrorMessage(preview.error, 'This version could not be previewed.')}</PreviewMessage>;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RemovedList lines={preview.data.warnings.map((notice) => notice.message)} />
      <PlaceholderNote count={preview.data.placeholderFigures} />
      <DocumentPreview html={preview.data.html} label="Question paper preview" fitPageWidth />
    </div>
  );
}

function VersionCard({ schoolId, view }: { schoolId: string; view: AssistantQuestionPaperView }) {
  const download = useDownloadQuestionPaper();
  const detail = useQuery({
    ...orpc.school.getQuestionPaperDetail.queryOptions({ input: { ...view, schoolId } }),
    retry: retryUnlessRefused,
  });
  if (detail.isPending) {
    return (
      <AssistantViewFrame title={view.title}>
        <Skeleton className="h-28 w-full rounded-xl" />
      </AssistantViewFrame>
    );
  }
  const version = detail.data?.versions.find((candidate) => candidate.versionNo === view.versionNo);
  if (!detail.data || !version) {
    return (
      <AssistantViewFrame title={view.title}>
        <PreviewMessage>This version of the question paper is not available.</PreviewMessage>
      </AssistantViewFrame>
    );
  }
  const { paper } = detail.data;
  return (
    <QuestionPaperVersionCard
      title={view.title}
      subtitle={`${paper.subjectName} (${paper.modeName}), ${paper.className}, ${paper.examName}`}
      versionNo={version.versionNo}
      removedCount={version.warningCount}
      isLatest={version.isLatest}
      downloading={download.isPending}
      onDownload={() =>
        download.mutate(
          { ...view, schoolId, versionNo: view.versionNo },
          { onError: (error) => toast.error(requestErrorMessage(error, 'The PDF could not be prepared.')) },
        )
      }
      preview={
        <PreviewDialog title={`Version ${version.versionNo}`} description="As it was saved, with the template it was printed with.">
          <VersionPreviewBody view={view} schoolId={schoolId} />
        </PreviewDialog>
      }
    />
  );
}

/**
 * A saved question paper version in the chat (the assistant's
 * `question_paper` view): Preview and Download PDF, read with the
 * user's session behind the paper's class permission. Older versions work
 * the same, so the user can compare them inside the chat.
 */
export function AssistantQuestionPaperViewBlock({ schoolId, view }: { schoolId: string; view: AssistantQuestionPaperView }) {
  return (
    <RequirePermissions
      permissions={{ action: CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS, resource: { kind: 'class', schoolId, classId: view.classId } }}
      fallback={
        <AssistantViewFrame title={view.title}>
          <PreviewMessage>You don’t have access to this question paper.</PreviewMessage>
        </AssistantViewFrame>
      }
      pending={
        <AssistantViewFrame title={view.title}>
          <Skeleton className="h-28 w-full rounded-xl" />
        </AssistantViewFrame>
      }
    >
      <VersionCard schoolId={schoolId} view={view} />
    </RequirePermissions>
  );
}
