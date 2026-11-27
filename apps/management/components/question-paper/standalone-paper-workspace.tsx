'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Camera, ChevronLeft, History, MoreVertical, Trash2 } from 'lucide-react';
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
import { cellStatus } from '@campuspilot/components/question-paper/question-paper-model';
import { VersionList } from '@campuspilot/components/question-paper/version-list';
import { LatestVersionDownloadItems } from '@campuspilot/components/question-paper/version-download';
import { DirtyGuard, LoadingExam, Notice, ReadError } from '@/components/exam/exam-common';
import { RequirePermissions } from '@/components/require-permissions';
import { paperCalls, paperPermission, standalonePaperLabelOf, type StandalonePaperTarget, type StudioDetail } from './paper-target';
import {
  compareAsked,
  currentJobFailure,
  hasStudioOf,
  inFlightJob,
  NEW_CHAT_PARAM,
  paperChatOf,
  requestErrorMessage,
  resolveView,
  uploadsInFlight,
  type QuestionPaperStart as QuestionPaperStartKind,
} from './question-paper-model';
import { QuestionPaperAssistantGate } from './question-paper-assistant-gate';
import { QuestionPaperStart } from './question-paper-start';
import { QuestionPaperStudio } from './question-paper-studio';
import { QuestionPaperTemplateAlert } from './question-paper-template-alert';
import { usePageUploads, type PageUploads } from './use-page-uploads';
import {
  useCanManageQuestionPaper,
  downloadFailedMessage,
  useDownloadQuestionPaper,
  useQuestionPaperDetail,
  useRefreshQuestionPaper,
  useStandalonePaperListsInvalidation,
} from './use-question-paper-detail';

/**
 * Where a standalone paper's screen lives, which its shell decides: a personal
 * space's papers (`/papers`) or a school's Question papers page
 * (`/sessions/{id}/question-papers`). `paperHref` is the paper's own address
 * without a query; `listHref` is where deleting it returns to.
 */
export type StandalonePaperPlace = { paperHref: string; listHref: string };

/** A standalone paper's address with the studio's facts (`?start=`, `?version=`, `?chat=`, `?compare=1`), as for an exam paper. */
function standalonePaperHref(place: StandalonePaperPlace, query?: { start?: QuestionPaperStartKind; version?: number; chat?: string; compare?: boolean }) {
  const params = new URLSearchParams();
  if (query?.start) params.set('start', query.start);
  if (query?.version) params.set('version', String(query.version));
  if (query?.chat) params.set('chat', query.chat);
  if (query?.compare) params.set('compare', '1');
  const search = params.toString();
  return `${place.paperHref}${search ? `?${search}` : ''}`;
}

/**
 * One standalone paper: a personal space's paper (docs/personal-space.md) or a
 * school's quick paper (docs/question-papers.md "Quick papers in a school").
 * The same screen as an exam paper's (`QuestionPaperWorkspace`), the first
 * screen until the paper has something to show and then the studio, fed by
 * the standalone paper procedures. It has no exam to end and cannot be copied
 * from an earlier paper. A quick paper prints with the school's template, so
 * while the school has none the template warning shows, as on an exam paper.
 */
export function StandalonePaperWorkspace({ target, place }: { target: StandalonePaperTarget; place: StandalonePaperPlace }) {
  return (
    <RequirePermissions
      permissions={paperPermission(target, 'read')}
      fallback={<Notice>This question paper is unavailable for your account.</Notice>}
      pending={<LoadingExam />}
    >
      <QuestionPaperAssistantGate schoolId={target.schoolId}>
        <WorkspaceData target={target} place={place} />
      </QuestionPaperAssistantGate>
    </RequirePermissions>
  );
}

function WorkspaceData({ target, place }: { target: StandalonePaperTarget; place: StandalonePaperPlace }) {
  const query = useQuestionPaperDetail(target);
  const canManage = useCanManageQuestionPaper(target);
  // Held data wins over a failed refetch, so a poll that fails never replaces a paper on screen.
  if (query.data === undefined) {
    return query.isPending ? <LoadingExam /> : <ReadError error={query.error} retry={query.refetch} />;
  }
  return (
    <>
      {query.data.templateConfigured ? null : <QuestionPaperTemplateAlert schoolId={target.schoolId} />}
      <PaperLayout target={target} place={place} detail={query.data} canManage={canManage} />
    </>
  );
}

/** The paper's name as its details state it, and its state as a badge in the studio. */
function PaperHeading({ detail, showStatus }: { detail: StudioDetail; showStatus: boolean }) {
  const details = detail.paper.details;
  const status = cellStatus({
    pageCount: detail.paper.pageCount,
    latestVersionNo: detail.paper.latestVersionNo,
    warningCount: detail.versions.find((version) => version.isLatest)?.warningCount ?? 0,
    activeJob: inFlightJob(detail.activeJob),
    lastJobFailure: currentJobFailure(detail),
  });
  const title = details?.subjectName ?? 'Question paper';
  const facts = [details?.className, details?.examName, details?.schoolName].filter((part): part is string => Boolean(part));
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate text-sm text-muted-foreground">{facts.length > 0 ? facts.join(' · ') : 'Details appear once the paper is written'}</p>
        {showStatus ? <Badge variant="outline">{status.label}</Badge> : null}
      </div>
    </div>
  );
}

/** Every saved version in a dialog, with its PDF; opening one shows it in the studio. */
function VersionsDialog({
  target,
  detail,
  open,
  onOpenChange,
  onShow,
}: {
  target: StandalonePaperTarget;
  detail: StudioDetail;
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
            downloading={download.isPending && download.variables ? { versionNo: download.variables.versionNo, format: download.variables.format } : null}
            onPreview={(versionNo) => {
              onOpenChange(false);
              onShow(versionNo);
            }}
            onDownload={(versionNo, format) =>
              download.mutate(
                { target, versionNo, format },
                { onError: (error) => toast.error(requestErrorMessage(error, downloadFailedMessage(format))) },
              )
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The paper's actions that are not its main task: its versions, its latest PDF, adding photos and deleting it. */
function PaperMenu({
  target,
  place,
  detail,
  canManage,
  onStart,
  onShowVersion,
}: {
  target: StandalonePaperTarget;
  place: StandalonePaperPlace;
  detail: StudioDetail;
  canManage: boolean;
  onStart: (start: QuestionPaperStartKind) => void;
  onShowVersion: (versionNo: number) => void;
}) {
  const router = useRouter();
  const invalidateLists = useStandalonePaperListsInvalidation();
  const [confirming, setConfirming] = useState(false);
  const [showingVersions, setShowingVersions] = useState(false);
  const download = useDownloadQuestionPaper();
  const remove = useMutation({
    mutationFn: () => paperCalls.deletePaper(target),
    onSuccess: async () => {
      setConfirming(false);
      await invalidateLists();
      router.replace(place.listHref);
    },
    onError: (error) => toast.error(requestErrorMessage(error, 'The paper could not be deleted.')),
  });
  const hasVersion = detail.paper.latestVersionNo > 0;
  const canDelete = canManage && inFlightJob(detail.activeJob) === null;
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
            <LatestVersionDownloadItems
              disabled={!hasVersion}
              pending={download.isPending ? (download.variables?.format ?? null) : null}
              onDownload={(format) =>
                download.mutate(
                  { target, versionNo: detail.paper.latestVersionNo, format },
                  { onError: (error) => toast.error(requestErrorMessage(error, downloadFailedMessage(format))) },
                )
              }
            />
          </DropdownMenuGroup>
          {hasVersion && canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onStart('sources')}>
                  <Camera aria-hidden />
                  Add photos or a file
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
      <VersionsDialog target={target} detail={detail} open={showingVersions} onOpenChange={setShowingVersions} onShow={onShowVersion} />
      <ConfirmationDialog
        open={confirming}
        title="Delete this question paper?"
        description="The uploaded photos, every version and every stored PDF of this paper are deleted. This cannot be undone. Its conversations with the assistant stay in your history."
        confirmLabel="Delete paper"
        pending={remove.isPending}
        onOpenChange={setConfirming}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

/** Leaving the paper while photos are still on their way asks first. */
function UploadsGuard({ uploads }: { uploads: PageUploads }) {
  return (
    <uploads.form.Subscribe selector={(state) => uploadsInFlight(state.values.items) > 0}>
      {(uploading) => <DirtyGuard dirty={uploading} description="Photos are still uploading. The ones not stored yet will be lost." />}
    </uploads.form.Subscribe>
  );
}

function PaperLayout({ target, place, detail, canManage }: { target: StandalonePaperTarget; place: StandalonePaperPlace; detail: StudioDetail; canManage: boolean }) {
  const router = useRouter();
  const refresh = useRefreshQuestionPaper(target);
  // Owned here, above the views, as on an exam paper's screen.
  const uploads = usePageUploads({ pageKey: target, refresh });
  const search = useSearchParams();
  const chatId = paperChatOf(search.get('chat'), detail.latestConversationId);
  const hasVersion = detail.paper.latestVersionNo > 0;
  const generating = inFlightJob(detail.activeJob) !== null;
  const view = resolveView({ start: search.get('start'), hasVersion, generating, hasChat: chatId !== null });
  const hasStudio = hasStudioOf({ hasVersion, generating, chatId, latestConversationId: detail.latestConversationId });
  const compare = compareAsked(search.get('compare'));
  const show = (query: Parameters<typeof standalonePaperHref>[1], how: 'push' | 'replace' = 'replace') =>
    router[how](standalonePaperHref(place, { compare, ...query }), { scroll: false });
  const openStudio = (query: { version?: number; chat?: string } = {}) => show({ chat: query.chat ?? chatId ?? undefined, version: query.version });
  const start = (next: QuestionPaperStartKind) => show({ start: next, chat: chatId ?? undefined }, 'push');
  const back = hasStudio ? () => openStudio() : null;
  const heading = <PaperHeading detail={detail} showStatus={view.kind === 'studio'} />;
  const menu = <PaperMenu target={target} place={place} detail={detail} canManage={canManage} onStart={start} onShowVersion={(version) => openStudio({ version })} />;
  return (
    <div ref={uploads.rootRef} className="contents">
      <UploadsGuard uploads={uploads} />
      {view.kind === 'studio' ? (
        <QuestionPaperStudio
          scope={target}
          detail={detail}
          paperLabel={standalonePaperLabelOf(detail.paper.details)}
          canManage={canManage}
          chatId={chatId}
          versionParam={search.get('version')}
          compare={compare}
          uploads={uploads}
          heading={heading}
          menu={menu}
          notice={null}
          onVersion={(version) => show({ chat: chatId ?? undefined, version: version ?? undefined })}
          onChat={(chat) => show({ chat: chat ?? NEW_CHAT_PARAM, version: Number(search.get('version')) || undefined })}
          onCompare={(on) => show({ chat: search.get('chat') ?? undefined, version: Number(search.get('version')) || undefined, compare: on })}
          onOpenPhotos={() => start('sources')}
          onOpenSources={detail.paper.pageCount > 0 || canManage ? () => start('sources') : null}
        />
      ) : (
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5 md:pt-6">
          <div className="flex items-start gap-2">
            {back ? (
              <Button type="button" variant="ghost" size="icon" className="-ml-2 shrink-0" aria-label="Back to the paper" onClick={back}>
                <ChevronLeft aria-hidden />
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">{heading}</div>
            {menu}
          </div>
          <QuestionPaperStart
            scope={target}
            detail={detail}
            examNames={null}
            canManage={canManage}
            uploads={uploads}
            earlierOpen={false}
            onEarlierOpenChange={() => undefined}
            onOpenStudio={openStudio}
            onBack={back}
          />
        </div>
      )}
    </div>
  );
}
