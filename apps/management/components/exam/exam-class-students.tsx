'use client';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  DataTable,
  TableSearchBar,
  TableFilterBar,
} from '@campuspilot/components/data-grid';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import {
  ExamFrame,
  ExamPager,
  LoadingExam,
  Notice,
  ReadError,
} from './exam-common';
import { schoolPermission, type ExamScope } from './exam-model';
import { examStudentHref } from './exam-model';

type Scope = ExamScope & { classId: string };
export function ExamClassStudents({ scope }: { scope: Scope }) {
  return (
    <RequirePermissions
      permissions={[
        SCHOOL_ACTIONS.READ_EXAMS,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
        SCHOOL_ACTIONS.READ_EXAM_RESULTS,
      ].map((action) => schoolPermission(scope.schoolId, action))}
      fallback={<Notice>Class result access is unavailable.</Notice>}
    >
      <ClassData scope={scope} />
    </RequirePermissions>
  );
}
function ClassData({ scope }: { scope: Scope }) {
  const query = useQuery(
    orpc.school.listExamClasses.queryOptions({
      input: { ...scope, filters: { classId: scope.classId } },
    }),
  );
  const form = useForm({
    defaultValues: { page: 1, sectionId: '', search: '' },
    validators: {
      onChange: z.object({
        page: z.number().int().positive(),
        sectionId: z.string(),
        search: z.string().max(100),
      }),
    },
  });
  if (query.isPending) return <LoadingExam />;
  if (!query.data)
    return <ReadError error={query.error} retry={() => query.refetch()} />;
  const schoolClass = query.data.items[0];
  if (!schoolClass) return <Notice>No exam plan found for this class.</Notice>;
  return (
    <ExamFrame
      level="h2"
      title={schoolClass.label}
      description={`${schoolClass.subjectCount} ${schoolClass.subjectCount === 1 ? 'subject' : 'subjects'}`}
    >
      {query.isError && (
        <ReadError error={query.error} retry={() => query.refetch()} />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <form.Field name="search">
          {(field) => (
            <TableSearchBar
              defaultValue={field.state.value}
              placeholder="Search students"
              onSearchChange={(value) => {
                field.handleChange((value ?? '').slice(0, 100));
                form.setFieldValue('page', 1);
              }}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.sectionId}>
          {(sectionId) => (
            <TableFilterBar
              filters={[
                {
                  id: 'sectionId',
                  label: 'Section',
                  type: 'single',
                  options: schoolClass.sections.map((section) => ({
                    value: section.id,
                    label: section.label,
                  })),
                },
              ]}
              values={{ sectionId: sectionId || undefined }}
              onValuesChange={(values) => {
                form.setFieldValue(
                  'sectionId',
                  typeof values.sectionId === 'string' ? values.sectionId : '',
                );
                form.setFieldValue('page', 1);
              }}
            />
          )}
        </form.Subscribe>
      </div>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <StudentsPage
            scope={scope}
            {...values}
            onPage={(page) => form.setFieldValue('page', page)}
          />
        )}
      </form.Subscribe>
    </ExamFrame>
  );
}
function StudentsPage({
  scope,
  page,
  sectionId,
  search,
  onPage,
}: {
  scope: Scope;
  page: number;
  sectionId: string;
  search: string;
  onPage: (page: number) => void;
}) {
  const query = useQuery(
    orpc.school.listExamStudents.queryOptions({
      input: {
        ...scope,
        page,
        searchQuery: search,
        filters: sectionId ? { sectionId } : undefined,
      },
      placeholderData: keepPreviousData,
    }),
  );
  if (query.isPending) return <LoadingExam />;
  if (!query.data)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <>
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      <DataTable
        ariaLabel="Class examination students"
        data={query.data.items}
        emptyMessage="No registered students match this selection."
        columns={[
          {
            id: 'name',
            header: 'Student',
            cell: ({ row }) => (
              <Link
                className="flex flex-col justify-center font-medium hover:underline"
                href={examStudentHref({
                  ...scope,
                  studentId: row.original.studentId,
                })}
              >
                {row.original.name}
              </Link>
            ),
          },
          {
            accessorKey: 'admissionNo',
            header: 'Admission no.',
            enableSorting: false,
          },
          {
            id: 'section',
            header: 'Section',
            cell: ({ row }) => row.original.sectionLabel ?? 'Unassigned',
          },
          {
            id: 'roll',
            header: 'Roll no.',
            cell: ({ row }) => row.original.rollNo ?? '—',
          },
          {
            id: 'progress',
            header: 'Results',
            cell: ({ row }) =>
              `${row.original.savedSubjects} / ${row.original.subjectCount} subjects`,
          },
          {
            id: 'review',
            header: 'Review',
            cell: ({ row }) =>
              row.original.approvedSubjects === row.original.subjectCount &&
              row.original.assessmentApproved
                ? 'Approved'
                : row.original.savedSubjects > 0
                  ? 'Awaiting review'
                  : 'Not started',
          },
        ]}
      />
      <ExamPager
        page={query.data.pagination.currentPage}
        pages={query.data.pagination.totalPages}
        total={query.data.pagination.totalItems}
        disabled={query.isFetching}
        onPage={onPage}
      />
    </>
  );
}
