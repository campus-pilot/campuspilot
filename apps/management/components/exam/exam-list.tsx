'use client';
import Link from 'next/link';
import { Badge } from '@campuspilot/ui/components/badge';
import { ClipboardCheck } from 'lucide-react';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import {
  ExamFrame,
  ExamPager,
  ExamSession,
  LoadingExam,
  Notice,
  ReadError,
} from './exam-common';
import {
  examHref,
  examStatusLabel,
  schoolPermission,
  type SessionScope,
} from './exam-model';

export function ExamList({ scope }: { scope: SessionScope }) {
  return (
    <RequirePermissions
      permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAMS)}
      fallback={<Notice>Examination access is unavailable.</Notice>}
    >
      <ExamFrame
        title="Examinations"
        description="View the exams configured in session settings, manage plans, and review results."
      >
        <ExamSession scope={scope}>
          {() => <ExamListData scope={scope} />}
        </ExamSession>
      </ExamFrame>
    </RequirePermissions>
  );
}
function ExamListData({ scope }: { scope: SessionScope }) {
  const form = useForm({
    defaultValues: { page: 1 },
    validators: { onChange: z.object({ page: z.number().int().positive() }) },
  });
  return (
    <form.Subscribe selector={(state) => state.values.page}>
      {(page) => (
        <ExamListPage
          scope={scope}
          page={page}
          onPage={(page) => form.setFieldValue('page', page)}
        />
      )}
    </form.Subscribe>
  );
}
function ExamListPage({
  scope,
  page,
  onPage,
}: {
  scope: SessionScope;
  page: number;
  onPage: (value: number) => void;
}) {
  const query = useQuery(
    orpc.school.listExams.queryOptions({
      placeholderData: keepPreviousData,
      input: {
        ...scope,
        page,
        limit: 20,
        orderBy: { field: 'order', direction: 'asc' },
      },
    }),
  );
  if (query.isPending) return <LoadingExam />;
  if (query.isError && !query.data)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <>
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {query.data!.items.length === 0 ? (
        <Notice>
          No exams configured. Add examinations in session settings.
        </Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {query.data!.items.map((exam) => (
            <article key={exam.slug}>
              <Link
                href={examHref(scope, exam.slug)}
                className="flex h-full min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <ClipboardCheck
                    className="size-5 text-muted-foreground"
                    aria-hidden
                  />
                  <Badge variant="outline">
                    {examStatusLabel(exam.status)}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-semibold">{exam.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {exam.planCount > 0
                      ? 'Exam plan generated'
                      : 'Exam plan not generated'}
                  </p>
                </div>
                {(exam.startedAt || exam.completedAt) && (
                  <p className="text-xs text-muted-foreground">
                    {exam.completedAt
                      ? `Completed ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(exam.completedAt)}`
                      : `Started ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(exam.startedAt!)}`}
                  </p>
                )}
              </Link>
            </article>
          ))}
        </div>
      )}
      {query.data!.pagination.totalPages > 1 && (
        <ExamPager
          page={query.data!.pagination.currentPage}
          disabled={query.isFetching}
          pages={query.data!.pagination.totalPages}
          total={query.data!.pagination.totalItems}
          onPage={onPage}
        />
      )}
    </>
  );
}
