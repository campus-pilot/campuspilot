'use client';
import { useRef } from 'react';
import { DocumentExportLink } from '@/components/documents/document-export-link';
import type { StudentExamWorkspaceDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import {
  ExamButton,
  ExamFrame,
  ExamSession,
  LoadingExam,
  Notice,
  ReadError,
} from './exam-common';
import {
  schoolPermission,
  toExamScope,
  isExamResultEntryOpen,
  type ExamScope,
} from './exam-model';
import { StudentExamForm } from './exam-student-workspace-form';
import { StudentExamPreview } from '@campuspilot/components/exam/student-exam-preview';

export type StudentExamScope = ExamScope & {
  classId: string;
  studentId: string;
};
export function ExamStudentWorkspace({ scope }: { scope: StudentExamScope }) {
  return (
    <RequirePermissions
      permissions={[
        SCHOOL_ACTIONS.READ_EXAMS,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
        SCHOOL_ACTIONS.READ_EXAM_RESULTS,
      ].map((action) => schoolPermission(scope.schoolId, action))}
      fallback={<Notice>Student result access is unavailable.</Notice>}
    >
      <ExamSession scope={scope}>
        {(active) => <StudentData scope={scope} active={active} />}
      </ExamSession>
    </RequirePermissions>
  );
}
function StudentData({
  scope,
  active,
}: {
  scope: StudentExamScope;
  active: boolean;
}) {
  const query = useQuery(
    orpc.school.getStudentExam.queryOptions({ input: scope }),
  );
  const overview = useQuery(
    orpc.school.getExamOverview.queryOptions({ input: toExamScope(scope) }),
  );
  if (query.isPending || overview.isPending) return <LoadingExam />;
  if (!query.data)
    return <ReadError error={query.error} retry={query.refetch} />;
  const data = query.data;
  const open =
    !query.isError &&
    !overview.isError &&
    isExamResultEntryOpen(
      active,
      overview.data?.status ?? null,
      data.subjects.map(({ plan }) => plan),
    );
  return (
    <ExamFrame
      level="h2"
      title={data.student.name}
      description={`${data.className}${data.student.sectionLabel ? ` · ${data.student.sectionLabel}` : ''} · ${data.context.exam.name} · ${data.student.admissionNo}`}
    >
      {(query.isError || overview.isError) && (
        <ReadError
          error={query.error ?? overview.error}
          retry={() => Promise.all([query.refetch(), overview.refetch()])}
        />
      )}
      <StudentResults
        scope={scope}
        data={data}
        open={open}
        completed={overview.data?.status === 'completed'}
      />
    </ExamFrame>
  );
}

/** Choose the landing mode only after data and lifecycle have loaded. A mounted
 * editor keeps its baseline when lifecycle/refetch checks later close entry;
 * saving or cancelling deliberately returns to the saved preview.
 */
function StudentResults({
  scope,
  data,
  open,
  completed,
}: {
  scope: StudentExamScope;
  data: StudentExamWorkspaceDto;
  open: boolean;
  completed: boolean;
}) {
  const initialMode = useRef({ editing: open }).current;
  const ui = useForm({
    defaultValues: initialMode,
    validators: { onChange: z.object({ editing: z.boolean() }) },
  });
  const approved =
    data.assessment?.approved ||
    data.subjects.some(({ result }) => result?.approved);
  const writePermissions = [
    schoolPermission(scope.schoolId, SCHOOL_ACTIONS.WRITE_EXAM_RESULTS),
    ...(approved
      ? [schoolPermission(scope.schoolId, SCHOOL_ACTIONS.REVISE_EXAM_RESULTS)]
      : []),
  ];
  return (
    <ui.Subscribe selector={(state) => state.values.editing}>
      {(editing) => {
        const preview = (
          <>
            <div className="flex justify-end">
              <DocumentExportLink
                scope={scope}
                type="report_card"
                examSlug={scope.examSlug}
                classId={scope.classId}
                studentId={scope.studentId}
                label="Create report card PDF"
              />
            </div>
            <StudentExamPreview data={data} />
            {!open && (
              <p className="text-sm text-muted-foreground">
                {completed
                  ? 'Examination completed · Results are read-only.'
                  : 'Result entry is not open.'}
              </p>
            )}
            {open && (
              <RequirePermissions permissions={writePermissions}>
                <ExamButton
                  className="self-start"
                  onClick={() => ui.setFieldValue('editing', true)}
                >
                  {data.student.savedSubjects
                    ? 'Edit results'
                    : 'Enter results'}
                </ExamButton>
              </RequirePermissions>
            )}
            {open && approved && (
              <p className="text-sm text-muted-foreground">
                Approved results can be revised by the exam coordinator,
                principal or manager.
              </p>
            )}
          </>
        );
        return editing ? (
          <RequirePermissions permissions={writePermissions} fallback={preview}>
            <StudentExamForm
              scope={scope}
              initial={data}
              latest={data}
              active={open}
              onDone={() => ui.setFieldValue('editing', false)}
            />
          </RequirePermissions>
        ) : (
          preview
        );
      }}
    </ui.Subscribe>
  );
}
