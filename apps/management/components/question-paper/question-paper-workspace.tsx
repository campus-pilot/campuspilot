'use client';

import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, MoreVertical, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@campuspilot/ui/components/tabs';
import { toast } from '@campuspilot/ui/lib/toast';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { cellStatus, isPaperLocked, paperLockReason } from '@campuspilot/components/question-paper/question-paper-model';
import { RequirePermissions } from '@/components/require-permissions';
import { DirtyGuard, LoadingExam, Notice, ReadError } from '@/components/exam/exam-common';
import { questionPaperHref } from '@/components/exam/exam-model';
import { orpc } from '@/lib/orpc';
import {
  currentJobFailure,
  inFlightJob,
  QUESTION_PAPER_SECTIONS,
  questionPaperPermission,
  requestErrorMessage,
  resolveSection,
  resolveVersionNo,
  SECTION_LABELS,
  uploadsInFlight,
  type QuestionPaperScope,
  type QuestionPaperSection,
} from './question-paper-model';
import { QuestionPaperAssistantGate } from './question-paper-assistant-gate';
import { QuestionPaperPagesSection } from './question-paper-pages-section';
import { QuestionPaperResultSection } from './question-paper-result-section';
import { QuestionPaperTemplateAlert } from './question-paper-template-alert';
import { QuestionPaperVersionsSection } from './question-paper-versions-section';
import { usePageUploads, type PageUploads } from './use-page-uploads';
import {
  useCanManageQuestionPaper,
  useDownloadQuestionPaper,
  useQuestionPaperDetail,
  useRefreshQuestionPaper,
  type QuestionPaperDetail,
} from './use-question-paper-detail';

/**
 * One paper: a class, subject and assessment mode of an exam. Sections Pages,
 * Result and Versions are line tabs (the section and the shown version live in
 * the URL, so a reload or a shared link lands in the same place). Breadcrumbs
 * give the way back; there is no feature-level back button.
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

function PaperHeading({ detail }: { detail: QuestionPaperDetail }) {
  const { paper } = detail;
  const status = cellStatus({
    pageCount: paper.pageCount,
    latestVersionNo: paper.latestVersionNo,
    totalMarks: detail.versions[0]?.totalMarks ?? null,
    planMaxMarks: paper.planMaxMarks,
    warningCount: detail.versions[0]?.warningCount ?? 0,
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
        <Badge variant="outline">{status.label}</Badge>
      </div>
    </div>
  );
}

function PaperMenu({ scope, detail, canManage }: { scope: QuestionPaperScope; detail: QuestionPaperDetail; canManage: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
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
  const canDelete = canManage && !isPaperLocked(paper) && inFlightJob(detail.activeJob) === null && paper.paperId !== null;
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
            <DropdownMenuItem
              disabled={paper.latestVersionNo === 0}
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
            <DropdownMenuItem disabled={!canDelete} variant="destructive" onSelect={() => setConfirming(true)}>
              <Trash2 aria-hidden />
              Delete paper
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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

function SectionTabs({ section, onSelect }: { section: QuestionPaperSection; onSelect: (section: QuestionPaperSection) => void }) {
  return (
    <Tabs value={section} onValueChange={(value) => onSelect(value as QuestionPaperSection)}>
      <TabsList variant="line" className="h-auto">
        {QUESTION_PAPER_SECTIONS.map((id) => (
          <TabsTrigger key={id} value={id} className="h-9 flex-none px-3 text-sm">
            {SECTION_LABELS[id]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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
  // The upload queue is owned here, above the sections: switching section keeps uploads, their order and their slot count.
  const uploads = usePageUploads({ pageKey: scope, refresh });
  const pathname = usePathname();
  const search = useSearchParams();
  const hasVersion = detail.paper.latestVersionNo > 0;
  const section = resolveSection(search.get('section'), hasVersion);
  const versionNo = resolveVersionNo(search.get('version'), detail.versions.map((version) => version.versionNo));
  const go = (next: { section: QuestionPaperSection; version?: number }) => {
    const params = new URLSearchParams({ section: next.section });
    if (next.version !== undefined) params.set('version', String(next.version));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  let body: ReactNode;
  if (section === 'pages') body = <QuestionPaperPagesSection scope={scope} detail={detail} canManage={canManage} uploads={uploads} />;
  else if (section === 'result')
    body = (
      <QuestionPaperResultSection
        scope={scope}
        detail={detail}
        versionNo={versionNo}
        onSelectVersion={(version) => go({ section: 'result', version })}
      />
    );
  else
    body = (
      <QuestionPaperVersionsSection
        scope={scope}
        detail={detail}
        selectedVersionNo={versionNo}
        onPreview={(version) => go({ section: 'result', version })}
      />
    );
  return (
    <div ref={uploads.rootRef} className="flex min-w-0 flex-col gap-4">
      <UploadsGuard uploads={uploads} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PaperHeading detail={detail} />
        <PaperMenu scope={scope} detail={detail} canManage={canManage} />
      </div>
      {paperLockReason(detail.paper) ? (
        <Notice>{paperLockReason(detail.paper)} You can still preview and download its papers.</Notice>
      ) : null}
      <SectionTabs section={section} onSelect={(next) => go({ section: next, version: next === 'pages' ? undefined : (versionNo ?? undefined) })} />
      <div className="min-w-0">{body}</div>
    </div>
  );
}
