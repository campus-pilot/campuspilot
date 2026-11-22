'use client';

import { SCHOOL_ACTIONS, type PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { SchoolQuestionPaperFilters, SchoolQuestionPaperListItemDto } from '@campuspilot/api/routers/school/question-paper/question-paper.school-list.dto';
import {
  DataTable,
  DataTableSuspense,
  TableFilterBar,
  TableSearchBar,
  useDataTableListState,
  type DataTableColumnDef,
  type DataTableListController,
  type TableFilterConfig,
} from '@campuspilot/components/data-grid';
import { cellStatus } from '@campuspilot/components/question-paper/question-paper-model';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { cn } from '@campuspilot/ui/lib/utils';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { standalonePaperPermission } from './paper-target';
import { QuestionPaperAssistantGate } from './question-paper-assistant-gate';
import { requestErrorMessage } from './question-paper-model';
import {
  DEFAULT_QUESTION_PAPER_FILTERS,
  QUESTION_PAPER_STATUS_OPTIONS,
  QUESTION_PAPER_TYPE_LABELS,
  QUESTION_PAPER_TYPE_OPTIONS,
  questionPaperRowNames,
  quickPaperHref,
  schoolQuestionPaperHref,
  type QuestionPapersScope,
} from './school-question-papers-model';

type PaperController = DataTableListController<'updatedAt', SchoolQuestionPaperFilters>;

const updatedOn = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** A column a phone leaves out (below `sm`); what it shows is under the paper's title there instead. */
const PHONE_HIDDEN = 'hidden sm:table-cell';

/** The school permissions the page is made of: it shows for someone who may read either kind of paper. */
const pagePermissions = (schoolId: string): PermissionCheck[] => [
  { action: SCHOOL_ACTIONS.READ_EXAM_PLANS, resource: { kind: 'school', schoolId } },
  standalonePaperPermission(schoolId, 'read'),
];

/**
 * Creates a quick paper in the session (or reuses an unused one of the
 * person's) and opens it on its first screen: photos, a PDF or a description.
 * Why creating failed is said beside the button until the next attempt.
 */
export function CreateQuickPaperButton({ scope, placement }: { scope: QuestionPapersScope; placement: 'header' | 'empty' }) {
  const router = useRouter();
  const create = useMutation(
    orpc.school.createStandalonePaper.mutationOptions({
      onSuccess: ({ paperId }) => router.push(quickPaperHref(scope, paperId)),
    }),
  );
  return (
    <RequirePermissions permissions={standalonePaperPermission(scope.schoolId, 'manage')}>
      <div className={cn('flex flex-col gap-1.5', placement === 'header' ? 'items-end text-right' : 'items-center text-center')}>
        <Button
          type="button"
          variant={placement === 'header' ? 'default' : 'outline'}
          disabled={create.isPending}
          onClick={() => create.mutate({ schoolId: scope.schoolId, sessionId: scope.sessionId })}
        >
          <Plus data-icon="inline-start" aria-hidden />
          {create.isPending ? 'Creating…' : 'Create question paper'}
        </Button>
        {create.error ? (
          <p role="alert" className="max-w-sm text-sm text-destructive">
            {requestErrorMessage(create.error, 'The paper could not be created.')}
          </p>
        ) : null}
      </div>
    </RequirePermissions>
  );
}

/** The paper's title and, on a phone only, its type, class and exam under it (the columns that show them there are left out). */
function PaperCell({ paper }: { paper: SchoolQuestionPaperListItemDto }) {
  const { title, facts } = questionPaperRowNames(paper);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground sm:hidden">{[QUESTION_PAPER_TYPE_LABELS[paper.type], ...facts].join(' · ')}</span>
    </span>
  );
}

/** A name as a cell: its value, or a quiet dash when the paper does not state it. */
const NameCell = ({ value }: { value: string | null }) => (value ? <span>{value}</span> : <span className="text-muted-foreground">-</span>);

/** Whether the list shows what the page opens with: no search, and no filter but the default type. */
function isDefaultView(controller: PaperController) {
  const { type, ...rest } = controller.query.filters ?? {};
  return !controller.query.searchQuery && type === DEFAULT_QUESTION_PAPER_FILTERS.type && Object.values(rest).every((value) => value === undefined);
}

function PaperRows({ scope, controller }: { scope: QuestionPapersScope; controller: PaperController }) {
  const router = useRouter();
  const filters = controller.query.filters ?? {};
  const { data } = useSuspenseQuery(
    orpc.school.listSchoolQuestionPapers.queryOptions({
      input: { ...scope, page: controller.query.page, limit: controller.query.limit, searchQuery: controller.query.searchQuery ?? '', filters },
    }),
  );
  const columns: DataTableColumnDef<SchoolQuestionPaperListItemDto>[] = [
    {
      id: 'paper',
      header: 'Paper',
      enableSorting: false,
      // On a phone the title and the facts under it wrap instead of widening the table.
      meta: { className: 'max-sm:whitespace-normal' },
      cell: ({ row }) => <PaperCell paper={row.original} />,
    },
    // On a phone only Paper (with its type, class and exam under it) and Status stay, so the list reads without sideways scrolling.
    { id: 'class', header: 'Class', enableSorting: false, meta: { className: PHONE_HIDDEN }, cell: ({ row }) => <NameCell value={row.original.className} /> },
    { id: 'exam', header: 'Exam', enableSorting: false, meta: { className: PHONE_HIDDEN }, cell: ({ row }) => <NameCell value={row.original.examName} /> },
    {
      id: 'type',
      header: 'Type',
      enableSorting: false,
      meta: { className: PHONE_HIDDEN },
      cell: ({ row }) => <Badge variant={row.original.type === 'quick' ? 'secondary' : 'outline'}>{QUESTION_PAPER_TYPE_LABELS[row.original.type]}</Badge>,
    },
    { id: 'createdBy', header: 'Created by', enableSorting: false, meta: { className: PHONE_HIDDEN }, cell: ({ row }) => <NameCell value={row.original.createdByName} /> },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => <Badge variant="outline">{cellStatus(row.original).label}</Badge>,
    },
    { id: 'updatedAt', header: 'Updated', enableSorting: false, meta: { className: PHONE_HIDDEN }, cell: ({ row }) => updatedOn.format(row.original.updatedAt) },
  ];
  const defaultView = isDefaultView(controller);
  // Only someone who may create quick papers is asked to make one; the same check as the button's gate.
  const canCreate =
    useQuery(orpc.authorization.checkPermissions.queryOptions({ input: { permissions: [standalonePaperPermission(scope.schoolId, 'manage')] } })).data?.results[0] === true;
  return (
    <DataTable
      ariaLabel="Question papers"
      columns={columns}
      data={data.items}
      getRowId={(paper) => paper.paperId}
      manualPagination
      manualSorting
      onPaginationChange={controller.onPaginationChange}
      onSortingChange={controller.onSortingChange}
      pageCount={data.pagination.totalPages}
      rowCount={data.pagination.totalItems}
      showPagination
      state={controller.tableState}
      onRowClick={(paper) => router.push(schoolQuestionPaperHref(scope, paper))}
      emptyMessage={
        !defaultView
          ? 'No question papers match.'
          : canCreate
            ? 'No quick papers yet. Create one from photos of a paper, a PDF or a description.'
            : 'No quick papers yet.'
      }
      emptyAction={defaultView ? <CreateQuickPaperButton scope={scope} placement="empty" /> : undefined}
    />
  );
}

/** The page's filters: type and status, then the names the session's papers show. */
function usePaperFilters(scope: QuestionPapersScope): TableFilterConfig<keyof SchoolQuestionPaperFilters>[] {
  const options = useQuery(orpc.school.listSchoolQuestionPaperFilterOptions.queryOptions({ input: scope }));
  const toOptions = (values: readonly string[] | undefined) => (values ?? []).map((value) => ({ value, label: value }));
  return [
    { id: 'type', label: 'Type', type: 'single' as const, options: [...QUESTION_PAPER_TYPE_OPTIONS] },
    { id: 'status', label: 'Status', type: 'single' as const, options: [...QUESTION_PAPER_STATUS_OPTIONS] },
    { id: 'examName', label: 'Exam', type: 'single' as const, options: toOptions(options.data?.examNames) },
    { id: 'className', label: 'Class', type: 'single' as const, options: toOptions(options.data?.classNames) },
    { id: 'subjectName', label: 'Subject', type: 'single' as const, options: toOptions(options.data?.subjectNames) },
  ];
}

/**
 * A school's Question papers page (docs/question-papers.md "The Question
 * papers page"): the session's quick papers and exam papers in one compact
 * table under the standard search and filter bars, most recently changed
 * first. It opens on quick papers; an exam paper is listed only once it has a
 * version unless a status is picked. Behind the same gates as its procedures:
 * a paper permission, then the assistant (question papers are part of AI).
 */
export function SchoolQuestionPaperList({ scope }: { scope: QuestionPapersScope }) {
  return (
    <RequirePermissions
      mode="any"
      permissions={pagePermissions(scope.schoolId)}
      fallback={<p className="text-sm text-muted-foreground">Question papers are unavailable for your account.</p>}
    >
      <QuestionPaperAssistantGate schoolId={scope.schoolId}>
        <PaperListContent scope={scope} />
      </QuestionPaperAssistantGate>
    </RequirePermissions>
  );
}

/** The list itself, for someone who may read papers and use the assistant. */
function PaperListContent({ scope }: { scope: QuestionPapersScope }) {
  const controller = useDataTableListState<'updatedAt', SchoolQuestionPaperFilters>({
    defaultOrderBy: { field: 'updatedAt', direction: 'desc' },
    defaultFilters: DEFAULT_QUESTION_PAPER_FILTERS,
  });
  const filters = usePaperFilters(scope);
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Question papers</h1>
          <p className="text-sm text-muted-foreground">Photograph a paper, attach a PDF or describe one, and the assistant types it up on your school's template.</p>
        </div>
        <CreateQuickPaperButton scope={scope} placement="header" />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TableSearchBar placeholder="Search exam, class or subject…" onSearchChange={controller.onSearchChange} />
        <TableFilterBar filters={filters} values={controller.query.filters ?? {}} onValuesChange={controller.onFiltersChange} />
      </div>
      <DataTableSuspense key={JSON.stringify(controller.query)} columnCount={7}>
        <PaperRows scope={scope} controller={controller} />
      </DataTableSuspense>
    </section>
  );
}
