'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import { GenerationStatus } from '@campuspilot/components/question-paper/generation-status';
import { PageThumbnailGrid } from '@campuspilot/components/question-paper/page-thumbnail-grid';
import { editBlockedReason, QUESTION_PAPER_MAX_PAGES } from '@campuspilot/components/question-paper/question-paper-model';
import { QuestionPaperUploadZone } from '@campuspilot/components/question-paper/question-paper-upload-zone';
import { UploadQueue } from '@campuspilot/components/question-paper/upload-queue';
import { Button } from '@campuspilot/ui/components/button';
import { orpc } from '@/lib/orpc';
import { questionPaperWorkspaceHref } from '@/components/exam/exam-model';
import { questionPaperThumbUrl } from '@/lib/question-paper-pages';
import { QuestionPaperGenerateForm } from './question-paper-generate-form';
import { applyPageOrder, currentJobFailure, generatedVersionReady, inFlightJob, isConflict, requestErrorMessage, uploadsInFlight, type QuestionPaperScope } from './question-paper-model';
import { useRefreshQuestionPaper, type QuestionPaperDetail } from './use-question-paper-detail';
import type { PageUploads } from './use-page-uploads';

type SectionProps = { scope: QuestionPaperScope; detail: QuestionPaperDetail; canManage: boolean; uploads: PageUploads };

/**
 * Reordering is optimistic: the grid shows the new order at once and the
 * server decides. On any failure the old order returns, and on a conflict
 * (someone else changed the pages) the list is reloaded and says so.
 */
function usePageReorder(scope: QuestionPaperScope) {
  const queryClient = useQueryClient();
  const refresh = useRefreshQuestionPaper(scope);
  const detailKey = orpc.school.getQuestionPaperDetail.queryKey({ input: scope });
  return useMutation(
    orpc.school.reorderQuestionPaperPages.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey: detailKey });
        const before = queryClient.getQueryData(detailKey);
        if (before) queryClient.setQueryData(detailKey, { ...before, pages: applyPageOrder(before.pages, input.pageIds) });
        return { before };
      },
      onError: (error, _input, context) => {
        if (context?.before) queryClient.setQueryData(detailKey, context.before);
        toast.error(
          isConflict(error)
            ? 'Someone changed the pages; reloaded.'
            : requestErrorMessage(error, 'The new order could not be saved.'),
        );
      },
      onSettled: refresh,
    }),
  );
}

function useDeletePage(scope: QuestionPaperScope) {
  const refresh = useRefreshQuestionPaper(scope);
  return useMutation(
    orpc.school.deleteQuestionPaperPage.mutationOptions({
      onError: (error) =>
        toast.error(
          isConflict(error)
            ? 'Someone changed the pages; reloaded.'
            : requestErrorMessage(error, 'The page could not be deleted.'),
        ),
      onSettled: refresh,
    }),
  );
}

function Rejections({ rejections, onDismiss }: { rejections: readonly { name: string; reason: string }[]; onDismiss: () => void }) {
  if (rejections.length === 0) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <ul className="flex flex-col gap-1 text-sm text-destructive">
        {rejections.map((rejection, index) => (
          // The name alone repeats: every camera capture is called question-paper-photo.jpg.
          <li key={`${index}:${rejection.name}`}>
            {rejection.name}: {rejection.reason}
          </li>
        ))}
      </ul>
      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

/**
 * What the background job says, derived from the polled detail: running, the
 * failure that is still news (not one a newer version has fixed), or the
 * version the job just produced with a link to it.
 */
function JobPanel({ scope, detail }: { scope: QuestionPaperScope; detail: QuestionPaperDetail }) {
  const running = inFlightJob(detail.activeJob);
  if (running) return <GenerationStatus job={running} />;
  const failure = currentJobFailure(detail);
  if (failure) return <GenerationStatus job={{ status: 'failed', message: failure.message }} />;
  const ready = generatedVersionReady(detail);
  if (ready === null) return null;
  // Keyed by the version: a later generation shows its own notice again after this one was dismissed.
  return <VersionReadyNotice key={ready} scope={scope} versionNo={ready} />;
}

/** "Version N is ready" with a View link; dismissing hides it until the next generation (not stored). */
function VersionReadyNotice({ scope, versionNo }: { scope: QuestionPaperScope; versionNo: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <span>Version {versionNo} is ready.</span>
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={questionPaperWorkspaceHref(scope, { section: 'result', version: versionNo })}>View</Link>
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function PagesHeader({ count }: { count: number }) {
  return (
    <h3 className="text-sm font-semibold">
      Pages <span className="font-normal text-muted-foreground">· {count} of {QUESTION_PAPER_MAX_PAGES}</span>
    </h3>
  );
}

/**
 * The upload, order and generate half of a paper. Every change is saved on the
 * server as it happens, so leaving and coming back continues where you were.
 * Uploading, reordering, deleting and generating are closed while the exam has
 * ended, a generation runs, or the user may only view; the reason is written.
 */
export function QuestionPaperPagesSection({ scope, detail, canManage, uploads }: SectionProps) {
  const { paper, pages } = detail;
  const reorder = usePageReorder(scope);
  const deletePage = useDeletePage(scope);
  const [deleting, setDeleting] = useState<string | null>(null);
  const blockedReason = editBlockedReason({ examCompleted: paper.examCompleted, sessionActive: paper.sessionActive, canManage, jobActive: inFlightJob(detail.activeJob) !== null });
  const deletingPage = pages.find((page) => page.id === deleting);
  return (
    <div className="flex flex-col gap-4">
      <JobPanel scope={scope} detail={detail} />
      <uploads.form.Subscribe selector={(state) => uploadsInFlight(state.values.items)}>
        {(inFlight) => (
          <QuestionPaperUploadZone
            remaining={QUESTION_PAPER_MAX_PAGES - paper.pageCount - inFlight}
            disabledReason={blockedReason}
            onFiles={(files) => uploads.addFiles(files, paper.pageCount)}
            onRejected={uploads.rejectFiles}
          />
        )}
      </uploads.form.Subscribe>
      <uploads.form.Subscribe selector={(state) => state.values.rejections}>
        {(rejections) => <Rejections rejections={rejections} onDismiss={uploads.dismissRejections} />}
      </uploads.form.Subscribe>
      <uploads.form.Subscribe selector={(state) => state.values.items}>
        {(items) => <UploadQueue items={items} onDismiss={uploads.dismiss} />}
      </uploads.form.Subscribe>
      <PagesHeader count={paper.pageCount} />
      {pages.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No photos yet. Add the pages of the question paper above.
        </p>
      ) : (
        // Every stored upload bumps the page revision a reorder or delete is checked against, so while photos are
        // on their way the grid is closed (and says so) instead of failing with a "someone else changed the pages".
        <uploads.form.Subscribe selector={(state) => uploadsInFlight(state.values.items) > 0}>
          {(uploading) => (
            <div className="flex flex-col gap-2">
              {uploading ? <p className="text-xs text-muted-foreground">Photos are still uploading. You can reorder or delete pages once they finish.</p> : null}
              <PageThumbnailGrid
                pages={pages}
                thumbUrl={(pageId) => questionPaperThumbUrl(scope, pageId)}
                disabled={blockedReason !== null || uploading || reorder.isPending || deletePage.isPending}
                onReorder={(pageIds) => reorder.mutate({ ...scope, pageIds, expectedPageRevision: paper.pageRevision })}
                onDelete={setDeleting}
              />
            </div>
          )}
        </uploads.form.Subscribe>
      )}
      {pages.some((page) => page.derivativeStatus === 'unsupported') ? (
        <p className="text-xs text-muted-foreground">
          Some photos have no preview here. The AI can still read them if its model supports the format; if generating
          is refused, convert those pages to JPEG and add them again.
        </p>
      ) : null}
      <uploads.form.Subscribe selector={(state) => uploadsInFlight(state.values.items) > 0}>
        {(uploading) => (
          <QuestionPaperGenerateForm
            key={paper.pageRevision}
            scope={scope}
            expectedPageRevision={paper.pageRevision}
            pageCount={paper.pageCount}
            templateConfigured={detail.templateConfigured}
            blockedReason={blockedReason}
            uploading={uploading}
          />
        )}
      </uploads.form.Subscribe>
      <ConfirmationDialog
        open={deletingPage !== undefined}
        title={deletingPage ? `Delete page ${deletingPage.position}?` : 'Delete page?'}
        description="The photo is removed from this paper and the remaining pages are renumbered. Versions already generated are not changed."
        confirmLabel="Delete page"
        pending={deletePage.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => {
          if (!deletingPage) return;
          deletePage.mutate(
            { ...scope, pageId: deletingPage.id, expectedPageRevision: paper.pageRevision },
            { onSettled: () => setDeleting(null) },
          );
        }}
      />
    </div>
  );
}
