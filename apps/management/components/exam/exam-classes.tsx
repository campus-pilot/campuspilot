'use client';
import Link from 'next/link';
import { DocumentExportLink } from '@/components/documents/document-export-link';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { DataTable } from '@campuspilot/components/data-grid';
import { orpc } from '@/lib/orpc';
import { ExamPager, LoadingExam, ReadError } from './exam-common';
import {
  examClassHref,
  examClassStatusLabel,
  schoolPermission,
  type ExamScope,
} from './exam-model';

export function ExamClasses({ scope }: { scope: ExamScope }) {
  const form = useForm({
    defaultValues: { page: 1 },
    validators: { onChange: z.object({ page: z.number().int().positive() }) },
  });
  return (
    <form.Subscribe selector={(state) => state.values.page}>
      {(page) => (
        <ClassesPage
          scope={scope}
          page={page}
          onPage={(page) => form.setFieldValue('page', page)}
        />
      )}
    </form.Subscribe>
  );
}
function ClassesPage({
  scope,
  page,
  onPage,
}: {
  scope: ExamScope;
  page: number;
  onPage: (page: number) => void;
}) {
  const overview = useQuery(
    orpc.school.getExamOverview.queryOptions({ input: scope }),
  );
  const query = useQuery(
    orpc.school.listExamClasses.queryOptions({
      input: { ...scope, page },
      placeholderData: keepPreviousData,
    }),
  );
  if (query.isPending || overview.isPending) return <LoadingExam />;
  if (!query.data)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <>
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      <div className="flex justify-end">
        <DocumentExportLink
          scope={scope}
          type="report_card"
          examSlug={scope.examSlug}
          label="Create examination report cards"
        />
      </div>
      <DataTable
        ariaLabel="Examination classes"
        data={query.data.items}
        columns={[
          {
            id: 'class',
            header: 'Class',
            cell: ({ row }) => (
              <RequirePermissions
                permissions={schoolPermission(
                  scope.schoolId,
                  SCHOOL_ACTIONS.READ_EXAM_RESULTS,
                )}
                fallback={<span>{row.original.label}</span>}
              >
                <Link
                  className="flex flex-col justify-center font-medium hover:underline"
                  href={examClassHref({
                    ...scope,
                    classId: row.original.classId,
                  })}
                >
                  {row.original.label}
                  <span className="text-xs font-normal text-muted-foreground">
                    {row.original.sections
                      .map((section) => section.label)
                      .join(', ') || 'No sections'}
                  </span>
                </Link>
              </RequirePermissions>
            ),
          },
          {
            id: 'students',
            header: 'Students',
            cell: ({ row }) => row.original.studentCount,
          },
          {
            id: 'subjects',
            header: 'Subjects',
            cell: ({ row }) => row.original.subjectCount,
          },
          {
            id: 'modes',
            header: 'Modes',
            cell: ({ row }) => row.original.modeCount,
          },
          {
            id: 'status',
            header: 'Status',
            cell: ({ row }) =>
              overview.isError || !overview.data
                ? 'Status unavailable'
                : examClassStatusLabel(
                    overview.data.status,
                    row.original.statuses,
                  ),
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
