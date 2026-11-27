'use client';

import { useQuery } from '@tanstack/react-query';
import { client, orpc } from '@/lib/orpc';
import { collectAllPages } from '@/components/management-command-model';

/** The facts of an examination the command palette and the first-paper step of the guided setup show. */
export type ExamSearchItem = {
  slug: string;
  name: string;
  status: 'ready' | 'active' | 'completed' | null;
};

/**
 * Every examination of a session, all pages in the session's explicit exam
 * order (`listExams` pages at most 20 at a time), so its readers share one
 * cached list. The palette keeps it for as long as it is open
 * (`staleTime: Infinity`); other readers use the default `staleTime`. The exams
 * are in the session's configured order (`orderBy: order`), the order the
 * Examinations list uses.
 */
export function useAllExams(schoolId: string, sessionId: string, options: { staleTime?: number } = {}) {
  return useQuery({
    queryKey: [...orpc.school.listExams.queryKey({ input: { schoolId, sessionId } }), 'all-pages'],
    staleTime: options.staleTime,
    queryFn: () =>
      collectAllPages<ExamSearchItem>((page) =>
        client.school.listExams({
          schoolId,
          sessionId,
          page,
          limit: 20,
          orderBy: { field: 'order', direction: 'asc' },
        }),
      ),
  });
}
