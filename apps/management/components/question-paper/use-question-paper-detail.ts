'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VersionDownloadFormat } from '@campuspilot/components/question-paper/version-download';
import { toast } from '@campuspilot/ui/lib/toast';
import { orpc } from '@/lib/orpc';
import { detailPollInterval, isConflict, requestErrorMessage, type QuestionPaperScope } from './question-paper-model';
import {
  isStandaloneTarget,
  paperCalls,
  paperDetailQueryKey,
  paperDetailQueryOptions,
  paperPermission,
  type PaperTarget,
  type StudioDetail,
} from './paper-target';
import type { PageTurning } from './source-preview-dialogs';

/** A paper's detail as the studio reads it, for either kind of paper (`paper-target.ts`). */
export type QuestionPaperDetail = StudioDetail;

/**
 * The screen's one read of a paper. While a generation is queued or running it
 * is read again every 3 seconds (a `refetchInterval` callback, no effect); the
 * last data stays on screen if a poll fails.
 */
export function useQuestionPaperDetail(target: PaperTarget) {
  return useQuery(paperDetailQueryOptions(target, (data) => detailPollInterval(data as Parameters<typeof detailPollInterval>[0])));
}

/**
 * An exam paper's read, in the server's own shape (with the plan's names, for
 * the exam paper screen's heading). The same query as
 * {@link useQuestionPaperDetail} for that paper (one cache entry); only what
 * each screen reads of it differs.
 */
export function useExamQuestionPaperDetail(scope: QuestionPaperScope) {
  return useQuery(
    orpc.school.getQuestionPaperDetail.queryOptions({
      input: scope,
      refetchInterval: (query) => detailPollInterval(query.state.data),
    }),
  );
}

/** Whether the user may change this paper. Shares the cache entry of `RequirePermissions` for the same check. */
export function useCanManageQuestionPaper(target: PaperTarget) {
  const query = useQuery(
    orpc.authorization.checkPermissions.queryOptions({ input: { permissions: [paperPermission(target, 'manage')] } }),
  );
  return query.data?.results[0] === true;
}

/**
 * Reads every list a standalone paper shows in again: a personal space's
 * papers and a school's Question papers page, each with its filter values
 * (built from the papers' names). Resolves when they are fresh.
 */
export function useStandalonePaperListsInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.school.listStandalonePapers.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.school.listStandalonePaperFilterOptions.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.school.listSchoolQuestionPapers.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.school.listSchoolQuestionPaperFilterOptions.key() }),
    ]);
  };
}

/** Reads the paper and the lists it is in again, for example after an upload. Resolves when the paper is fresh. */
export function useRefreshQuestionPaper(target: PaperTarget) {
  const queryClient = useQueryClient();
  const invalidateStandaloneLists = useStandalonePaperListsInvalidation();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: paperDetailQueryKey(target) }),
      ...(isStandaloneTarget(target)
        ? [invalidateStandaloneLists()]
        : [
            queryClient.invalidateQueries({ queryKey: orpc.school.listQuestionPapers.key() }),
            // An exam paper shows on the school's Question papers page too.
            queryClient.invalidateQueries({ queryKey: orpc.school.listSchoolQuestionPapers.key() }),
            queryClient.invalidateQueries({ queryKey: orpc.school.listSchoolQuestionPaperFilterOptions.key() }),
          ]),
    ]);
  };
}

/**
 * Turning a page: the server makes the page's copies again turned, so this is
 * not optimistic; whoever shows the page (the page viewer, the comparison
 * beside the paper) dims it under a spinner until the paper is read again
 * with the turned copies (new image URLs). A failure is a toast, like the
 * other page changes, and a conflict reloads the pages.
 */
export function useRotatePage(target: PaperTarget) {
  const refresh = useRefreshQuestionPaper(target);
  return useMutation({
    mutationFn: (input: { pageId: string; rotation: 0 | 90 | 180 | 270; expectedPageRevision: number }) => paperCalls.rotatePage(target, input),
    onError: (error) => toast.error(isConflict(error) ? 'Someone changed the pages; reloaded.' : requestErrorMessage(error, 'The page could not be turned.')),
    onSettled: refresh,
  });
}

/**
 * What a place that shows a page needs in order to turn it with
 * {@link useRotatePage}: which page is being turned now, whether the buttons
 * must wait, and the request itself (the rotation the page should have,
 * checked against the page revision the screen holds). `otherChange` says
 * another page change is on its way (an upload, a reorder, a removal): like a
 * turn, each bumps that revision, so a turn waits for it.
 */
export function pageTurningOf(rotate: ReturnType<typeof useRotatePage>, pageRevision: number, otherChange: boolean): PageTurning {
  return {
    turningPageId: rotate.isPending ? (rotate.variables?.pageId ?? null) : null,
    busy: otherChange || rotate.isPending,
    onRotate: (pageId, rotation) => rotate.mutate({ pageId, rotation, expectedPageRevision: pageRevision }),
  };
}

/** What a failed download says when the server's refusal gives no sentence of its own. */
export const downloadFailedMessage = (format: VersionDownloadFormat) =>
  format === 'docx' ? 'The Word file could not be prepared.' : 'The PDF could not be prepared.';

/**
 * Downloads a version as its PDF or as an editable Word file: asks for a
 * five-minute signed URL and navigates to it (an attachment, so the page stays
 * put). The first Word download of a version makes the file, so it can take a
 * few seconds; `variables.format` says which one is being prepared. Call
 * `mutate({ target, versionNo, format })`.
 */
export function useDownloadQuestionPaper() {
  return useMutation({
    mutationFn: ({ target, versionNo, format }: { target: PaperTarget; versionNo: number; format: VersionDownloadFormat }) =>
      paperCalls.download(target, versionNo, format),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });
}
