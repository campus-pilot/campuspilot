'use client';
import { useQuery } from '@tanstack/react-query';
import { redirect } from 'next/navigation';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { useAssistantGate } from '@/components/assistant/assistant-access';
import { orpc } from '@/lib/orpc';
import { LoadingExam, ReadError } from './exam-common';
import { defaultExamSection, examResultsHref, questionPaperHref, schoolPermission, type ExamScope } from './exam-model';

/**
 * The examination root: redirects to the default section and renders nothing
 * else. `redirect()` during render replaces the history entry, so Back does
 * not return to the root and loop (and no effect is involved).
 *
 * It waits while the overview or the assistant answer is loading, because
 * Question paper is the default only when the assistant gate is known to be
 * open. A failed overview read offers a retry instead of guessing a section.
 */
export function ExamLanding({ scope }: { scope: ExamScope }) {
  // The same gate as the Results page the root used to be: without it the overview read would end in a raw read error.
  return (
    <RequirePermissions permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAM_PLANS)}>
      <ExamLandingRedirect scope={scope} />
    </RequirePermissions>
  );
}

function ExamLandingRedirect({ scope }: { scope: ExamScope }) {
  const overview = useQuery(orpc.school.getExamOverview.queryOptions({ input: scope }));
  const assistant = useAssistantGate(scope.schoolId);
  if (!overview.data) {
    return overview.isPending ? <LoadingExam /> : <ReadError error={overview.error} retry={overview.refetch} />;
  }
  const section = defaultExamSection({
    planCount: overview.data.planCount,
    status: overview.data.status,
    assistant,
  });
  if (section === 'pending') return <LoadingExam />;
  redirect(section === 'question-paper' ? questionPaperHref(scope) : examResultsHref(scope));
}
