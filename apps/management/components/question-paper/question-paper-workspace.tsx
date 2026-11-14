'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Camera, Copy, Download, History, MoreVertical, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { cellStatus, isPaperLocked, paperLockReason } from '@campuspilot/components/question-paper/question-paper-model';
import { VersionList } from '@campuspilot/components/question-paper/version-list';
import { RequirePermissions } from '@/components/require-permissions';
import { DirtyGuard, LoadingExam, Notice, ReadError } from '@/components/exam/exam-common';
import { questionPaperHref, questionPaperWorkspaceHref } from '@/components/exam/exam-model';
import { orpc } from '@/lib/orpc';
import {
  chatIdOf,
  currentJobFailure,
  inFlightJob,
  questionPaperPermission,
  requestErrorMessage,
  resolveView,
  uploadsInFlight,
  type QuestionPaperScope,
  type QuestionPaperStart as QuestionPaperStartKind,
} from './question-paper-model';
import { QuestionPaperAssistantGate } from './question-paper-assistant-gate';
import { QuestionPaperStart } from './question-paper-start';
import { QuestionPaperStudio } from './question-paper-studio';
import { QuestionPaperTemplateAlert } from './question-paper-template-alert';
import { usePageUploads, type PageUploads } from './use-page-uploads';
import {
  useCanManageQuestionPaper,
  useDownloadQuestionPaper,
  useQuestionPaperDetail,
  useRefreshQuestionPaper,
  type QuestionPaperDetail,
} from './use-question-paper-detail';

/**
 * One paper: a class, subject and assessment mode of an exam. A paper with
 * nothing yet asks how to begin (`QuestionPaperStart`); once it has a version,
 * a generation at work or a conversation it is the studio, the paper beside
 * its assistant (`QuestionPaperStudio`). What is shown lives in the URL (the
 * way of starting, the version, the conversation), so a reload or a shared
 * link lands in the same place. Breadcrumbs give the way back; there is no
 * feature-level back button.
 */
export function QuestionPaperWorkspace({ scope }: { scope: QuestionPaperScope }) {
  return (
    <RequirePermissions
      permissions={questionPaperPermission(scope, 'read')}
      fallback={<Notice>Question papers of this class are unavailable for your account.</Notice>}
      pending={<LoadingExam />}
    >
      <QuestionPaperAssistantGate schoolId={scope.schoolId}>
        <WorkspaceData scope={scope} />
      </QuestionPaperAssistantGate>
    </RequirePermissions>
  );
}

function WorkspaceData({ scope }: { scope: QuestionPaperScope }) {
  const query = useQuestionPaperDetail(scope);
  const canManage = useCanManageQuestionPaper(scope);
  // Held data wins over a failed refetch, so a poll that fails never replaces a paper on screen.
  if (query.data === undefined) {
    return query.isPending ? <LoadingExam /> : <ReadError error={query.error} retry={query.refetch} />;
  }
  return (
    <>
      {query.data.templateConfigured ? null : <QuestionPaperTemplateAlert schoolId={scope.schoolId} />}
      <PaperLayout scope={scope} detail={query.data} canManage={canManage} />
    </>
  );
}

/** The paper's name and plan. `showStatus` adds its state as a badge; the first screen leaves it out, where the card itself shows what the paper has. */
function PaperHeading({ detail, showStatus }: { detail: QuestionPaperDetail; showStatus: boolean }) {
  const { paper } = detail;
  const status = cellStatus({
    pageCount: paper.pageCount,
    latestVersionNo: paper.latestVersionNo,
    warningCount: detail.versions.find((version) => version.isLatest)?.warningCount ?? 0,
    activeJob: inFlightJob(detail.activeJob),
    lastJobFailure: currentJobFailure(detail),
  });
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="truncate text-lg font-semibold tracking-tight">
        {paper.subjectName} · {paper.modeName}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {paper.className} · {paper.examName} · {paper.planMaxMarks} marks
        </p>
        {showStatus ? <Badge variant="outline">{status.label}</Badge> : null}
      </div>
    </div>
  );
}

/** Every saved version in a dialog: who saved it, when and how, with its PDF. Opening one shows it in the studio. */
function VersionsDialog({
  scope,
  detail,
  open,
  onOpenChange,
  onShow,
}: {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShow: (versionNo: number) => void;
}) {
  const download = useDownloadQuestionPaper();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Versions</DialogTitle>
          <DialogDescription>Every change is a new version. Earlier ones are kept and can be downloaded.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] overflow-y-auto">
          <VersionList
            versions={detail.versions.map((version) => ({
              versionNo: version.versionNo,
              source: version.source,
              createdAt: version.createdAt,
              createdByName: version.createdBy.name,
              warningCount: version.warningCount,
              isLatest: version.isLatest,
            }))}
            selectedVersionNo={null}
            downloadingVersionNo={download.isPending ? (download.variables?.versionNo ?? null) : null}
            onPreview={(versionNo) => {
              onOpenChange(false);
              onShow(versionNo);
            }}
            onDownload={(versionNo) =>
              download.mutate(
                { ...scope, versionNo },
                { onError: (error) => toast.error(requestErrorMessage(error, 'The PDF could not be prepared.')) },
              )
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The paper's actions that are not its main task: its versions, starting it
 * again another way, its latest PDF and deleting it. Starting again is only
 * offered to someone who may change a paper that can still be changed.
 */
function PaperMenu({
  scope,
  detail,
  canManage,
  onStart,
  onShowVersion,
}: {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  canManage: boolean;
  onStart: (start: QuestionPaperStartKind) => void;
  onShowVersion: (versionNo: number) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [showingVersions, setShowingVersions] = useState(false);
  const refresh = useRefreshQuestionPaper(scope);
  const download = useDownloadQuestionPaper();
  const remove = useMutation(
    orpc.school.deleteQuestionPaper.mutationOptions({
      onSuccess: async () => {
        setConfirming(false);
        await refresh();
        router.replace(questionPaperHref(scope));
      },
      onError: (error) => toast.error(requestErrorMessage(error, 'The paper could not be deleted.')),
    }),
  );
  const { paper } = detail;
  const hasVersion = paper.latestVersionNo > 0;
  const canChange = canManage && !isPaperLocked(paper);
  const canDelete = canChange && inFlightJob(detail.activeJob) === null && paper.paperId !== null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Question paper actions">
            <MoreVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={!hasVersion} onSelect={() => setShowingVersions(true)}>
              <History aria-hidden />
              All versions
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!hasVersion}
              onSelect={() =>
                download.mutate(
                  { ...scope, versionNo: paper.latestVersionNo },
                  { onError: (error) => toast.error(requestErrorMessage(error, 'The PDF could not be prepared.')) },
                )
              }
            >
              <Download aria-hidden />
              Download latest PDF
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {hasVersion && canChange ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onStart('sources')}>
                  <Camera aria-hidden />
                  Add photos or a file
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onStart('earlier')}>
                  <Copy aria-hidden />
                  Copy an earlier paper
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={!canDelete} variant="destructive" onSelect={() => setConfirming(true)}>
              <Trash2 aria-hidden />
              Delete paper
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <VersionsDialog scope={scope} detail={detail} open={showingVersions} onOpenChange={setShowingVersions} onShow={onShowVersion} />
      <ConfirmationDialog
        open={confirming}
        title="Delete this question paper?"
        description="The uploaded photos, every version and every stored PDF of this paper are deleted. This cannot be undone."
        confirmLabel="Delete paper"
        pending={remove.isPending}
        onOpenChange={setConfirming}
        onConfirm={() => remove.mutate(scope)}
      />
    </>
  );
}

/** Leaving the paper (a link, back, reload) while photos are still on their way asks first. */
function UploadsGuard({ uploads }: { uploads: PageUploads }) {
  return (
    <uploads.form.Subscribe selector={(state) => uploadsInFlight(state.values.items) > 0}>
      {(uploading) => (
        <DirtyGuard dirty={uploading} description="Photos are still uploading. The ones not stored yet will be lost." />
      )}
    </uploads.form.Subscribe>
  );
}

function PaperLayout({ scope, detail, canManage }: { scope: QuestionPaperScope; detail: QuestionPaperDetail; canManage: boolean }) {
  const router = useRouter();
  const refresh = useRefreshQuestionPaper(scope);
  // The upload queue is owned here, above the views: switching between them keeps uploads, their order and their slot count.
  const uploads = usePageUploads({ pageKey: scope, refresh });
  const search = useSearchParams();
  const chatId = chatIdOf(search.get('chat'));
  const hasVersion = detail.paper.latestVersionNo > 0;
  const view = resolveView({
    start: search.get('start'),
    hasVersion,
    generating: inFlightJob(detail.activeJob) !== null,
    hasChat: chatId !== null,
  });
  /** What the screen shows lives in the address. Opening the first screen or its picker is a step the Back button undoes; the rest replaces. */
  const show = (query: Parameters<typeof questionPaperWorkspaceHref>[1], how: 'push' | 'replace' = 'replace') =>
    router[how](questionPaperWorkspaceHref(scope, query), { scroll: false });
  const openStudio = (query: { version?: number; chat?: string } = {}) => show({ chat: query.chat ?? chatId ?? undefined, version: query.version });
  const start = (next: QuestionPaperStartKind) => show({ start: next, chat: chatId ?? undefined }, 'push');
  /** Closing the picker returns to the first screen: named in the address only where the paper would otherwise show its studio. */
  const closePicker = () => show({ start: hasVersion || chatId !== null ? 'sources' : undefined, chat: chatId ?? undefined });
  const heading = <PaperHeading detail={detail} showStatus={view.kind === 'studio'} />;
  const menu = <PaperMenu scope={scope} detail={detail} canManage={canManage} onStart={start} onShowVersion={(version) => openStudio({ version })} />;
  const lockReason = paperLockReason(detail.paper);
  const notice = lockReason ? <Notice>{lockReason} You can still preview and download its papers.</Notice> : null;
  return (
    // The root only carries the uploads' ref across both views; each view lays itself out.
    <div ref={uploads.rootRef} className="contents">
      <UploadsGuard uploads={uploads} />
      {view.kind === 'studio' ? (
        <QuestionPaperStudio
          scope={scope}
          detail={detail}
          canManage={canManage}
          chatId={chatId}
          versionParam={search.get('version')}
          heading={heading}
          menu={menu}
          notice={notice}
          onVersion={(version) => show({ chat: chatId ?? undefined, version: version ?? undefined })}
          onChat={(chat) => show({ chat: chat ?? undefined, version: Number(search.get('version')) || undefined })}
          onOpenPhotos={() => start('sources')}
        />
      ) : (
        // One centred column: the paper's name, then the card it is made in. Nothing else competes with it.
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5 md:pt-6">
          <div className="flex items-start justify-between gap-3">
            {heading}
            {menu}
          </div>
          {notice}
          <QuestionPaperStart
            scope={scope}
            detail={detail}
            canManage={canManage}
            uploads={uploads}
            earlierOpen={view.picking}
            onEarlierOpenChange={(open) => (open ? start('earlier') : closePicker())}
            onOpenStudio={openStudio}
          />
        </div>
      )}
    </div>
  );
}
