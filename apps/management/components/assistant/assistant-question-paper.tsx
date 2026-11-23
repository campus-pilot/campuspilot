'use client';

import { CLASS_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import type { AssistantQuestionPaperView, AssistantStandaloneQuestionPaperView } from '@campuspilot/assistant-contract/views';
import type { AssistantTimelineRow } from '@campuspilot/components/assistant/timeline-model';
import { AssistantViewFrame } from '@campuspilot/components/assistant';
import { DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { PreviewDialogContent } from '@campuspilot/components/documents/preview-dialog';
import {
  draftCallsNeedingRecheck,
  draftFactsOf,
  isStandaloneDraft,
  parseDraftCallInput,
  parseStoredDraftResult,
  saveDraftMessage,
  type DraftPaperKey,
  type DraftResult,
} from '@campuspilot/components/question-paper/chat-cards-model';
import { PlaceholderNote, RemovedList } from '@campuspilot/components/question-paper/paper-notices';
import { QuestionPaperDraftCard, QuestionPaperVersionCard } from '@campuspilot/components/question-paper/chat-cards';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogTrigger } from '@campuspilot/ui/components/dialog';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { toast } from '@campuspilot/ui/lib/toast';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import type { ReactNode } from 'react';

import { RequirePermissions } from '@/components/require-permissions';
import { downloadFailedMessage, useDownloadQuestionPaper } from '@/components/question-paper/use-question-paper-detail';
import { VersionPdf } from '@/components/question-paper/version-pdf';
import { requestErrorMessage } from '@/components/question-paper/question-paper-model';
import { paperPreviewQueryOptions, standalonePaperLabelOf, standalonePaperPermission, type PaperTarget } from '@/components/question-paper/paper-target';
import { client, orpc } from '@/lib/orpc';

import { draftCheckOf, paperLabelFromKey, paperLabelOf } from './assistant-question-paper-model';
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
      <PreviewDialogContent title={title} description={description}>
        {children}
      </PreviewDialogContent>
    </Dialog>
  );
}

function PreviewMessage({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

type DraftInput = NonNullable<ReturnType<typeof parseDraftCallInput>>;

/**
 * The draft rendered with the school's currently selected template. The render
 * depends on that template (and on the chat attachments the draft names),
 * which can change while the chat is open, and the draft id (a hash of the text
 * alone) says nothing about either, so the cached render is only trusted for a
 * minute: opening Preview later renders again. The key still names the paper,
 * because the heading names the class, subject and exam. The server reads the
 * stored input, never the model.
 */
export function DraftPreviewBody({
  schoolId,
  conversationId,
  input,
  draftId,
  fill = false,
}: {
  schoolId: string;
  /** The chat the draft is from: its attachments preview as figures (the server checks it is a chat of the paper the user may use). */
  conversationId: string;
  input: DraftInput;
  draftId: string;
  /** The preview takes its container's height (the paper's pane) instead of a fixed frame; see `DocumentPreview`. */
  fill?: boolean;
}) {
  const preview = useQuery({
    queryKey: [
      'assistant',
      'question-paper-draft-preview',
      schoolId,
      // A standalone paper's draft (docs/personal-space.md) is named by its paper's id, an exam paper's by its key.
      ...(isStandaloneDraft(input) ? ['standalone', input.paperId] : [input.sessionId, input.examSlug, input.classId, input.subjectSlug, input.modeSlug]),
      draftId,
      conversationId,
    ],
    queryFn: () =>
      isStandaloneDraft(input)
        ? client.school.previewStandalonePaperDraft({ ...input, conversationId })
        : client.school.previewQuestionPaperDraft({ ...input, conversationId }),
    staleTime: DRAFT_PREVIEW_STALE_MS,
    retry: retryUnlessRefused,
  });
  if (preview.isPending) return <Skeleton className={fill ? 'h-full w-full rounded-xl' : 'h-96 w-full rounded-xl'} />;
  if (preview.isError) return <PreviewMessage>{requestErrorMessage(preview.error, 'The draft could not be previewed.')}</PreviewMessage>;
  if (preview.data.problems.length > 0) return <PreviewMessage>{preview.data.problems[0]}</PreviewMessage>;
  return <DocumentPreview html={preview.data.html} label="Draft preview" fitPageWidth fill={fill} />;
}

/** How long a draft preview is trusted before Preview renders it again (the school's template can change). */
const DRAFT_PREVIEW_STALE_MS = 60_000;

/**
 * The result of a draft check: what the call stored when it can be trusted,
 * otherwise the stored input checked again with the user's own session (the
 * display copy of an output is cut at 4,000 characters, so only drafts with
 * a long list of findings need it). The verdict is cached for the lifetime of
 * the page (`gcTime`), so reopening conversations does not validate again;
 * only a page reload does, and only for those long results.
 */
function draftRecheckOptions(call: { id: string; conversationId: string }, input: DraftInput | null, stored: DraftResult | null) {
  return {
    queryKey: ['assistant', 'question-paper-draft-check', call.id],
    queryFn: () =>
      isStandaloneDraft(input!)
        ? client.school.validateStandalonePaperDraft({ ...input!, conversationId: call.conversationId })
        : client.school.validateQuestionPaperDraft({ ...input!, conversationId: call.conversationId }),
    enabled: !stored && Boolean(input),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: retryUnlessRefused,
  };
}

function useDraftCheck(call: AssistantToolCallItemDto, input: DraftInput | null) {
  const stored = parseStoredDraftResult(call.body.output, call.body.outputTruncated);
  const recheck = useQuery(draftRecheckOptions(call, input, stored));
  return { check: draftCheckOf({ input, stored, recheck }), retry: () => void recheck.refetch() };
}

/**
 * The re-check verdicts of the conversation's drafts whose stored result was
 * cut, by call id, for the chat to decide which draft replaced which. It uses
 * the same query keys as each card's own re-check, so a card and the chat share
 * one request per draft, and nothing is checked for a draft whose stored result is readable.
 */
export function useDraftVerdicts(rows: readonly AssistantTimelineRow[], conversationId: string | null): ReadonlyMap<string, DraftResult> {
  const pending = conversationId ? draftCallsNeedingRecheck(rows) : [];
  return useQueries({
    queries: pending.map(({ id, input }) => draftRecheckOptions({ id, conversationId: conversationId! }, input, null)),
    combine: (results) => {
      const verdicts = new Map<string, DraftResult>();
      pending.forEach(({ id }, index) => {
        const data = results[index]?.data;
        if (data) verdicts.set(id, data);
      });
      return verdicts;
    },
  });
}

/**
 * The names of the paper a draft is for, to word the save request. Shares the
 * paper detail query with the version card. `null` while loading; when the
 * names cannot be read the request falls back to the paper's key
 * (`paperLabelFromKey`), so Save is never blocked by a failed read.
 */
function useDraftPaperLabel(schoolId: string, input: DraftInput | null) {
  const exam = input && !isStandaloneDraft(input) ? input : null;
  const standalone = input && isStandaloneDraft(input) ? input : null;
  const detail = useQuery({
    ...orpc.school.getQuestionPaperDetail.queryOptions({
      input: {
        schoolId,
        sessionId: exam?.sessionId ?? '',
        examSlug: exam?.examSlug ?? '',
        classId: exam?.classId ?? '',
        subjectSlug: exam?.subjectSlug ?? '',
        modeSlug: exam?.modeSlug ?? '',
      },
    }),
    enabled: exam !== null,
    retry: retryUnlessRefused,
  });
  // A standalone paper is named by its details (the same words its own screen's save request uses).
  const standaloneDetail = useQuery({
    ...orpc.school.getStandalonePaperDetail.queryOptions({ input: { schoolId, paperId: standalone?.paperId ?? '' } }),
    enabled: standalone !== null,
    retry: retryUnlessRefused,
  });
  if (standalone) {
    if (standaloneDetail.data) return standalonePaperLabelOf(standaloneDetail.data.paper.details);
    return standaloneDetail.isError ? standalonePaperLabelOf(null) : null;
  }
  if (!exam) return null;
  if (detail.data) return paperLabelOf(detail.data.paper);
  return detail.isError ? paperLabelFromKey(exam) : null;
}

function DraftUnavailable({ ordinal, children }: { ordinal: number; children: ReactNode }) {
  return (
    <AssistantViewFrame title={`Draft ${ordinal}`}>
      <div className="flex flex-col items-center gap-2">{children}</div>
    </AssistantViewFrame>
  );
}

/**
 * A draft question paper the assistant wrote (a `validateQuestionPaperDraft`
 * call). The assistant saves a valid draft by itself, and the card then says
 * it is saved; Preview renders it, and for a draft it did not save, Save as new
 * version sends the message that asks for it (decision D32), naming the paper.
 */
export function AssistantDraftCard({
  schoolId,
  call,
  ordinal,
  onSendMessage,
  saveRequested,
  saved,
  supersededBy,
}: {
  schoolId: string;
  call: AssistantToolCallItemDto;
  ordinal: number;
  /** Whether the conversation already holds this user message that saves the draft (the exact request sentence). */
  saveRequested: (request: string) => boolean;
  /** Whether a save of this draft for its paper went through later in the conversation. */
  saved: (paper: DraftPaperKey, draftId: string) => boolean;
  /** Sends a chat message; absent while the chat cannot send. */
  onSendMessage?: (text: string) => void;
  /** The ordinal of the later ready draft of the same paper that replaced this one, if any. */
  supersededBy?: number;
}) {
  const input = parseDraftCallInput(call.body.input);
  const { check, retry } = useDraftCheck(call, input);
  const paperLabel = useDraftPaperLabel(schoolId, input);
  if (check.state === 'unreadable') {
    return (
      <DraftUnavailable ordinal={ordinal}>
        <PreviewMessage>This draft can’t be shown.</PreviewMessage>
      </DraftUnavailable>
    );
  }
  if (check.state === 'checking') {
    return (
      <AssistantViewFrame title={`Draft ${ordinal}`}>
        <Skeleton className="h-24 w-full rounded-xl" />
      </AssistantViewFrame>
    );
  }
  if (check.state === 'failed') {
    return (
      <DraftUnavailable ordinal={ordinal}>
        <PreviewMessage>This draft couldn’t be checked.</PreviewMessage>
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      </DraftUnavailable>
    );
  }
  const facts = draftFactsOf(check.result);
  const request = facts.valid && paperLabel ? saveDraftMessage(facts.draftId, paperLabel) : null;
  return (
    <QuestionPaperDraftCard
      ordinal={ordinal}
      {...facts}
      supersededBy={supersededBy}
      preview={
        facts.valid && input ? (
          <PreviewDialog
            title={`Draft ${ordinal}`}
            description={input && isStandaloneDraft(input) ? 'How this draft prints. Nothing is saved.' : 'How this draft prints with your school’s template. Nothing is saved.'}
          >
            <DraftPreviewBody schoolId={schoolId} conversationId={call.conversationId} input={input} draftId={facts.draftId} fill />
          </PreviewDialog>
        ) : null
      }
      saveRequested={request !== null && saveRequested(request)}
      saved={facts.valid && input !== null && saved(input, facts.draftId)}
      onSave={request !== null && onSendMessage ? () => onSendMessage(request) : undefined}
    />
  );
}

/** A saved version in the Preview dialog: its PDF, under what was removed from its HTML and its figure placeholders (as in the studio). */
function VersionPreviewBody({ target, versionNo }: { target: PaperTarget; versionNo: number }) {
  const notes = useQuery({ ...paperPreviewQueryOptions(target, versionNo), retry: retryUnlessRefused });
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
      {notes.data ? (
        <>
          <RemovedList lines={notes.data.warnings.map((notice) => notice.message)} />
          <PlaceholderNote count={notes.data.placeholderFigures} />
        </>
      ) : null}
      {/* A long list of removed parts scrolls this column instead of squeezing the paper away. */}
      <div className="min-h-80 flex-1">
        <VersionPdf scope={target} versionNo={versionNo} />
      </div>
    </div>
  );
}

/**
 * One saved version as a card, for a paper of either kind (`paper-target.ts`):
 * its paper's name, Preview and Download PDF. `paperLabel` names the paper
 * from its detail (the plan's names, or a standalone paper's details).
 */
function VersionCard({
  title,
  target,
  versionNo,
  detail,
  paperLabel,
}: {
  title: string | undefined;
  target: PaperTarget;
  versionNo: number;
  detail: { isPending: boolean; data: { versions: Array<{ versionNo: number; warningCount: number; isLatest: boolean }> } | undefined };
  paperLabel: string | null;
}) {
  const download = useDownloadQuestionPaper();
  if (detail.isPending) {
    return (
      <AssistantViewFrame title={title}>
        <Skeleton className="h-28 w-full rounded-xl" />
      </AssistantViewFrame>
    );
  }
  const version = detail.data?.versions.find((candidate) => candidate.versionNo === versionNo);
  if (!detail.data || !version || paperLabel === null) {
    return (
      <AssistantViewFrame title={title}>
        <PreviewMessage>This version of the question paper is not available.</PreviewMessage>
      </AssistantViewFrame>
    );
  }
  return (
    <QuestionPaperVersionCard
      title={title}
      subtitle={paperLabel}
      versionNo={version.versionNo}
      removedCount={version.warningCount}
      isLatest={version.isLatest}
      downloading={download.isPending ? (download.variables?.format ?? null) : null}
      onDownload={(format) =>
        download.mutate({ target, versionNo, format }, { onError: (error) => toast.error(requestErrorMessage(error, downloadFailedMessage(format))) })
      }
      preview={
        <PreviewDialog title={`Version ${version.versionNo}`} description="As it was saved, as it was printed.">
          <VersionPreviewBody target={target} versionNo={versionNo} />
        </PreviewDialog>
      }
    />
  );
}

/** An exam paper's saved version: named by its plan. */
function ExamVersionCard({ schoolId, view }: { schoolId: string; view: AssistantQuestionPaperView }) {
  const target = { schoolId, sessionId: view.sessionId, examSlug: view.examSlug, classId: view.classId, subjectSlug: view.subjectSlug, modeSlug: view.modeSlug };
  const detail = useQuery({ ...orpc.school.getQuestionPaperDetail.queryOptions({ input: target }), retry: retryUnlessRefused });
  return <VersionCard title={view.title} target={target} versionNo={view.versionNo} detail={detail} paperLabel={detail.data ? paperLabelOf(detail.data.paper) : null} />;
}

/** A standalone paper's saved version (docs/personal-space.md): named by its details. */
function StandaloneVersionCard({ schoolId, view }: { schoolId: string; view: AssistantStandaloneQuestionPaperView }) {
  const target = { schoolId, paperId: view.paperId };
  const detail = useQuery({ ...orpc.school.getStandalonePaperDetail.queryOptions({ input: target }), retry: retryUnlessRefused });
  return (
    <VersionCard
      title={view.title}
      target={target}
      versionNo={view.versionNo}
      detail={detail}
      paperLabel={detail.data ? standalonePaperLabelOf(detail.data.paper.details) : null}
    />
  );
}

/** The frame of a version card while access is decided or refused. */
const VersionPending = ({ title }: { title: string | undefined }) => (
  <AssistantViewFrame title={title}>
    <Skeleton className="h-28 w-full rounded-xl" />
  </AssistantViewFrame>
);
const VersionRefused = ({ title }: { title: string | undefined }) => (
  <AssistantViewFrame title={title}>
    <PreviewMessage>You don’t have access to this question paper.</PreviewMessage>
  </AssistantViewFrame>
);

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
      fallback={<VersionRefused title={view.title} />}
      pending={<VersionPending title={view.title} />}
    >
      <ExamVersionCard schoolId={schoolId} view={view} />
    </RequirePermissions>
  );
}

/** The same for a standalone paper of a personal space (`standalone_question_paper` view), behind the school's standalone paper permission. */
export function AssistantStandalonePaperViewBlock({ schoolId, view }: { schoolId: string; view: AssistantStandaloneQuestionPaperView }) {
  return (
    <RequirePermissions
      permissions={standalonePaperPermission(schoolId, 'read')}
      fallback={<VersionRefused title={view.title} />}
      pending={<VersionPending title={view.title} />}
    >
      <StandaloneVersionCard schoolId={schoolId} view={view} />
    </RequirePermissions>
  );
}
