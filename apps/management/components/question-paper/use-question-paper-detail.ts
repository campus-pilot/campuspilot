'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { detailOutputSchema } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import { toast } from '@campuspilot/ui/lib/toast';
import { orpc } from '@/lib/orpc';
import { detailPollInterval, isConflict, questionPaperPermission, requestErrorMessage, type QuestionPaperScope } from './question-paper-model';
import type { PageTurning } from './source-preview-dialogs';

export type QuestionPaperDetail = z.infer<typeof detailOutputSchema>;

/**
 * The screen's one read of a paper. While a generation is queued or running it
 * is read again every 3 seconds (a `refetchInterval` callback, no effect); the
 * last data stays on screen if a poll fails.
 */
export function useQuestionPaperDetail(scope: QuestionPaperScope) {
  return useQuery(
    orpc.school.getQuestionPaperDetail.queryOptions({
      input: scope,
      refetchInterval: (query) => detailPollInterval(query.state.data),
    }),
  );
}

/** Whether the user may change this paper. Shares the cache entry of `RequirePermissions` for the same check. */
export function useCanManageQuestionPaper(scope: QuestionPaperScope) {
  const query = useQuery(
    orpc.authorization.checkPermissions.queryOptions({ input: { permissions: [questionPaperPermission(scope, 'manage')] } }),
  );
  return query.data?.results[0] === true;
}

/** Reads the paper and the exam's grid again, for example after an upload. Resolves when the paper is fresh. */
export function useRefreshQuestionPaper(scope: QuestionPaperScope) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.school.getQuestionPaperDetail.queryKey({ input: scope }) }),
      queryClient.invalidateQueries({ queryKey: orpc.school.listQuestionPapers.key() }),
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
export function useRotatePage(scope: QuestionPaperScope) {
  const refresh = useRefreshQuestionPaper(scope);
  return useMutation(
    orpc.school.rotateQuestionPaperPage.mutationOptions({
      onError: (error) => toast.error(isConflict(error) ? 'Someone changed the pages; reloaded.' : requestErrorMessage(error, 'The page could not be turned.')),
      onSettled: refresh,
    }),
  );
}

/**
 * What a place that shows a page needs in order to turn it with
 * {@link useRotatePage}: which page is being turned now, whether the buttons
 * must wait, and the request itself (the rotation the page should have,
 * checked against the page revision the screen holds). `otherChange` says
 * another page change is on its way (an upload, a reorder, a removal): like a
 * turn, each bumps that revision, so a turn waits for it.
 */
export function pageTurningOf(rotate: ReturnType<typeof useRotatePage>, scope: QuestionPaperScope, pageRevision: number, otherChange: boolean): PageTurning {
  return {
    turningPageId: rotate.isPending ? (rotate.variables?.pageId ?? null) : null,
    busy: otherChange || rotate.isPending,
    onRotate: (pageId, rotation) => rotate.mutate({ ...scope, pageId, rotation, expectedPageRevision: pageRevision }),
  };
}

/**
 * Downloads the PDF of a version: asks for a five-minute signed URL and
 * navigates to it (an attachment, so the page stays put). Call
 * `mutate({ ...scope, versionNo })`.
 */
export function useDownloadQuestionPaper() {
  return useMutation(
    orpc.school.getQuestionPaperDownload.mutationOptions({
      onSuccess: ({ url }) => {
        window.location.assign(url);
      },
    }),
  );
}
