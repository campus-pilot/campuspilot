'use client';
import { toPlanScope, toResultScope } from './exam-model';
import type {
  ExamPlanDto,
  ExamResultDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useRouter } from 'next/navigation';
import { client, orpc } from '@/lib/orpc';
import { useExamCache } from './exam-common';
import {
  approvalPermission,
  planHref,
  schoolPermission,
  type StudentRouteScope,
} from './exam-model';
import { ExamCommand } from './exam-command';

/** Review acts only on the persisted preview. Dirty editors do not mount standalone approval controls. */
export function ResultReviewActions({
  scope,
  result,
  plan,
  active,
}: {
  scope: StudentRouteScope;
  result: ExamResultDto;
  plan: ExamPlanDto;
  active: boolean;
}) {
  const queries = useExamCache();
  const router = useRouter();
  const revision = result.approved
    ? [schoolPermission(scope.schoolId, SCHOOL_ACTIONS.REVISE_EXAM_RESULTS)]
    : [];
  const refresh = async () => {
    await Promise.all([
      queries.results(scope),
      queries.cache.invalidateQueries({
        queryKey: orpc.school.getExamResult.key({
          input: toResultScope(scope),
        }),
      }),
      queries.cache.invalidateQueries({
        queryKey: orpc.school.getExamPlan.key({
          input: {
            schoolId: scope.schoolId,
            sessionId: scope.sessionId,
            classId: scope.classId,
            examPlanId: scope.examPlanId,
          },
        }),
      }),
      queries.cache.invalidateQueries({
        queryKey: orpc.school.getSession.key({
          input: { schoolId: scope.schoolId, sessionId: scope.sessionId },
        }),
      }),
    ]);
  };
  if (!active || plan.status !== 'active') return null;
  return (
    <div className="flex flex-col gap-3">
      <ExamCommand
        permissions={[
          approvalPermission(scope.schoolId, scope.classId),
          ...revision,
        ]}
        label={result.approved ? 'Revoke approval' : 'Approve saved result'}
        explanation={
          result.approved
            ? 'Return this saved result to Awaiting review? The marks remain unchanged.'
            : 'Approve the displayed saved values? This changes approval only.'
        }
        run={async () => {
          const saved = await client.school.approveExamResult({
            ...scope,
            approved: !result.approved,
          });
          queries.cache.setQueryData(
            orpc.school.getExamResult.queryKey({ input: toResultScope(scope) }),
            saved,
          );
          await queries.results(scope);
        }}
        onFailure={refresh}
      />
      <ExamCommand
        permissions={[
          schoolPermission(scope.schoolId, SCHOOL_ACTIONS.DELETE_EXAM_RESULTS),
          ...revision,
        ]}
        label="Delete result"
        destructive
        explanation={`Delete student ${scope.studentId}'s result for ${plan.subjectSlug} in ${plan.examSlug}? This returns the student to Not entered and can block completion.`}
        run={async () => {
          await client.school.deleteExamResult(toResultScope(scope));
          queries.cache.removeQueries({
            queryKey: orpc.school.getExamResult.key({
              input: toResultScope(scope),
            }),
          });
          await queries.results(scope);
          router.push(planHref(scope));
        }}
        onFailure={refresh}
      />
    </div>
  );
}
