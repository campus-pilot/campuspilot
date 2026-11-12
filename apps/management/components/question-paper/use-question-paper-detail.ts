'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { detailOutputSchema } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import { orpc } from '@/lib/orpc';
import { detailPollInterval, questionPaperPermission, type QuestionPaperScope } from './question-paper-model';

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
