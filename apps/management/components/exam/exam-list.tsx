'use client';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import {
  ExamButton,
  ExamFrame,
  ExamPager,
  ExamSession,
  LoadingExam,
  Notice,
  ReadError,
} from './exam-common';
import { examHref, schoolPermission, type SessionScope } from './exam-model';
import { ExamDefinitionForm } from './exam-definition-form';

export function ExamList({ scope }: { scope: SessionScope }) {
  return (
    <RequirePermissions
      permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAMS)}
      fallback={<Notice>Examination access is unavailable.</Notice>}
    >
      <ExamFrame
        title="Examinations"
        description="Configure assessments, enter marks, and review results."
      >
        <ExamSession scope={scope}>
          {(active) => <ExamListData scope={scope} active={active} />}
        </ExamSession>
      </ExamFrame>
    </RequirePermissions>
  );
}
function ExamListData({
  scope,
  active,
}: {
  scope: SessionScope;
  active: boolean;
}) {
  const form = useForm({
    defaultValues: { page: 1, creating: false },
    validators: {
      onChange: z.object({
        page: z.number().int().positive(),
        creating: z.boolean(),
      }),
    },
  });
  return (
    <form.Subscribe selector={(state) => state.values}>
      {({ page, creating }) => (
        <>
          {(active || creating) && (
            <RequirePermissions
              permissions={schoolPermission(
                scope.schoolId,
                SCHOOL_ACTIONS.CREATE_EXAM,
              )}
            >
              {creating ? (
                <ExamDefinitionForm
                  scope={scope}
                  active={active}
                  onClose={() => form.setFieldValue('creating', false)}
                />
              ) : (
                <ExamButton
                  className="self-start"
                  onClick={() => form.setFieldValue('creating', true)}
                >
                  Create exam
                </ExamButton>
              )}
            </RequirePermissions>
          )}
          <ExamListPage
            scope={scope}
            page={page}
            onPage={(page) => form.setFieldValue('page', page)}
          />
        </>
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
      {query.isFetching && <Notice>Refreshing this list…</Notice>}
      {query.data!.items.length === 0 ? (
        <Notice>No exams configured for this session</Notice>
      ) : (
        query.data!.items.map((exam) => (
          <Link
            key={exam.slug}
            href={examHref(scope, exam.slug)}
            className="flex min-w-0 flex-col gap-1 rounded-xl border p-4 hover:bg-muted/40"
          >
            <h2 className="break-words text-lg font-semibold">{exam.name}</h2>
            <span className="break-words text-sm text-muted-foreground">
              Order {exam.order} · {exam.slug}
            </span>
            <span className="mt-2 text-sm font-medium">Open exam →</span>
          </Link>
        ))
      )}
      <ExamPager
        page={query.data!.pagination.currentPage}
        disabled={query.isFetching}
        pages={query.data!.pagination.totalPages}
        total={query.data!.pagination.totalItems}
        onPage={onPage}
      />
    </>
  );
}
