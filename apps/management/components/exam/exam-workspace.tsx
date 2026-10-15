'use client';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import {
  ExamButton,
  ExamFrame,
  ExamSession,
  LoadingExam,
  Notice,
  ReadError,
  useExamCache,
} from './exam-common';
import { examHref, schoolPermission, type ExamScope } from './exam-model';
import { ExamDefinitionForm } from './exam-definition-form';
import { ExamPlans } from './exam-plans';
import { ExamTimetable } from './exam-timetable';
import { confirmNavigation } from '@/lib/navigation-guard';
import { ExamCommand } from './exam-command';

export function ExamWorkspace({ scope }: { scope: ExamScope }) {
  return (
    <RequirePermissions
      permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAMS)}
      fallback={<Notice>Examination access is unavailable.</Notice>}
    >
      <ExamSession scope={scope}>
        {(active) => <WorkspaceData scope={scope} active={active} />}
      </ExamSession>
    </RequirePermissions>
  );
}
function WorkspaceData({
  scope,
  active,
}: {
  scope: ExamScope;
  active: boolean;
}) {
  const query = useQuery(
    orpc.school.getExamContext.queryOptions({ input: scope }),
  );
  const queries = useExamCache();
  const router = useRouter();
  const form = useForm({
    defaultValues: { tab: 'plans', editing: false },
    validators: {
      onChange: z.object({
        tab: z.enum(['plans', 'timetable']),
        editing: z.boolean(),
      }),
    },
  });
  if (query.isPending) return <LoadingExam />;
  if (query.isError && !query.data)
    return (
      <ExamFrame
        title="Exam unavailable"
        description="Review the requested exam or retry."
        back={{ href: examHref(scope), label: 'Examinations' }}
      >
        <ReadError error={query.error} retry={query.refetch} />
      </ExamFrame>
    );
  const context = query.data!;
  return (
    <ExamFrame
      title={context.exam.name}
      description="Class and subject plans, results, and the optional shared timetable."
      back={{ href: examHref(scope), label: 'Examinations' }}
    >
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      <form.Subscribe selector={(state) => state.values}>
        {({ tab, editing }) => (
          <>
            {(active || editing) && (
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm">
                  Exam actions
                </summary>
                <div className="flex flex-col gap-3 pt-2">
                  <RequirePermissions
                    permissions={schoolPermission(
                      scope.schoolId,
                      SCHOOL_ACTIONS.UPDATE_EXAM,
                    )}
                  >
                    {editing ? (
                      <ExamDefinitionForm
                        scope={scope}
                        exam={context.exam}
                        active={active && !query.isError}
                        onClose={() => form.setFieldValue('editing', false)}
                      />
                    ) : (
                      <ExamButton
                        variant="outline"
                        onClick={() => form.setFieldValue('editing', true)}
                      >
                        Edit exam
                      </ExamButton>
                    )}
                  </RequirePermissions>
                  <ExamCommand
                    permissions={schoolPermission(
                      scope.schoolId,
                      SCHOOL_ACTIONS.DELETE_EXAM,
                    )}
                    label="Delete exam"
                    destructive
                    explanation={`Delete ${context.exam.name}? Plans and the shared timetable must be explicitly removed first. Referenced exams cannot be deleted.`}
                    run={async () => {
                      await client.school.deleteExam(scope);
                      queries.cache.removeQueries({
                        queryKey: orpc.school.getExamContext.key({
                          input: scope,
                        }),
                      });
                      queries.cache.removeQueries({
                        queryKey: orpc.school.getExam.key({ input: scope }),
                      });
                      await queries.definitions(scope, scope.examSlug);
                      router.push(examHref(scope));
                    }}
                  />
                </div>
              </details>
            )}
            <div
              role="tablist"
              aria-label="Exam workspace"
              className="flex flex-wrap gap-2"
            >
              <RequirePermissions
                permissions={schoolPermission(
                  scope.schoolId,
                  SCHOOL_ACTIONS.READ_EXAM_PLANS,
                )}
              >
                <ExamButton
                  role="tab"
                  aria-selected={tab === 'plans'}
                  variant={tab === 'plans' ? 'default' : 'outline'}
                  onClick={() => {
                    if (tab !== 'plans' && !confirmNavigation()) return;
                    form.setFieldValue('tab', 'plans');
                  }}
                >
                  Plans &amp; results
                </ExamButton>
              </RequirePermissions>
              <RequirePermissions
                permissions={schoolPermission(
                  scope.schoolId,
                  SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
                )}
              >
                <ExamButton
                  role="tab"
                  aria-selected={tab === 'timetable'}
                  variant={tab === 'timetable' ? 'default' : 'outline'}
                  onClick={() => {
                    if (tab !== 'timetable' && !confirmNavigation()) return;
                    form.setFieldValue('tab', 'timetable');
                  }}
                >
                  Timetable
                </ExamButton>
              </RequirePermissions>
            </div>
            {tab === 'plans' ? (
              <RequirePermissions
                permissions={schoolPermission(
                  scope.schoolId,
                  SCHOOL_ACTIONS.READ_EXAM_PLANS,
                )}
                fallback={<Notice>Plan access is unavailable.</Notice>}
              >
                <ExamPlans
                  scope={scope}
                  context={context}
                  active={active && !query.isError}
                />
              </RequirePermissions>
            ) : (
              <RequirePermissions
                permissions={schoolPermission(
                  scope.schoolId,
                  SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
                )}
                fallback={<Notice>Timetable access is unavailable.</Notice>}
              >
                <ExamTimetable
                  scope={scope}
                  context={context}
                  active={active && !query.isError}
                />
              </RequirePermissions>
            )}
          </>
        )}
      </form.Subscribe>
    </ExamFrame>
  );
}
