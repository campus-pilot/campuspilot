'use client';

import type { StandalonePaperListItemDto } from '@campuspilot/api/routers/school/standalone-paper/standalone-paper.dto';
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
import { toast } from '@campuspilot/ui/lib/toast';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { RequirePermissions } from '@/components/require-permissions';
import { standalonePaperPermission } from '@/components/question-paper/paper-target';
import { requestErrorMessage } from '@/components/question-paper/question-paper-model';
import { QuestionPaperAssistantGate } from '@/components/question-paper/question-paper-assistant-gate';
import { orpc } from '@/lib/orpc';
import { personalPaperHref } from './personal-space-model';

/** The list's filters: one per detail, each matched exactly against the values the school's papers state. */
type PaperFilters = { schoolName?: string; className?: string; subjectName?: string; examName?: string };
type PaperController = DataTableListController<'updatedAt', PaperFilters>;

const updatedOn = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** A detail as a cell: its value, or a quiet dash when the paper does not state it. */
const DetailCell = ({ value }: { value: string | null }) => (value ? <span>{value}</span> : <span className="text-muted-foreground">-</span>);

/** Creates an empty paper and opens it on its first screen (photos, a PDF or a description). */
function CreatePaperButton({ schoolId, variant = 'default' }: { schoolId: string; variant?: 'default' | 'outline' }) {
  const router = useRouter();
  const create = useMutation(
    orpc.school.createStandalonePaper.mutationOptions({
      onSuccess: ({ paperId }) => router.push(personalPaperHref(schoolId, paperId)),
      onError: (error) => toast.error(requestErrorMessage(error, 'The paper could not be created.')),
    }),
  );
  return (
    <RequirePermissions permissions={standalonePaperPermission(schoolId, 'manage')}>
      <Button type="button" variant={variant} disabled={create.isPending} onClick={() => create.mutate({ schoolId })}>
        <Plus data-icon="inline-start" aria-hidden />
        {create.isPending ? 'Creating…' : 'Create question paper'}
      </Button>
    </RequirePermissions>
  );
}

function PaperRows({ schoolId, controller }: { schoolId: string; controller: PaperController }) {
  const router = useRouter();
  const filters = controller.query.filters ?? {};
  const unfiltered = !controller.query.searchQuery && Object.values(filters).every((value) => value === undefined);
  const { data } = useSuspenseQuery(
    orpc.school.listStandalonePapers.queryOptions({
      input: { schoolId, page: controller.query.page, limit: controller.query.limit, searchQuery: controller.query.searchQuery ?? '', filters },
    }),
  );
  const columns: DataTableColumnDef<StandalonePaperListItemDto>[] = [
    {
      id: 'subject',
      header: 'Subject',
      enableSorting: false,
      cell: ({ row }) => <span className="font-medium">{row.original.details.subjectName ?? 'Untitled paper'}</span>,
    },
    { id: 'class', header: 'Class', enableSorting: false, cell: ({ row }) => <DetailCell value={row.original.details.className} /> },
    { id: 'exam', header: 'Exam', enableSorting: false, cell: ({ row }) => <DetailCell value={row.original.details.examName} /> },
    { id: 'school', header: 'School', enableSorting: false, cell: ({ row }) => <DetailCell value={row.original.details.schoolName} /> },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => <Badge variant="outline">{cellStatus(row.original).label}</Badge>,
    },
    { id: 'updatedAt', header: 'Updated', enableSorting: false, cell: ({ row }) => updatedOn.format(row.original.updatedAt) },
  ];
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
      onRowClick={(paper) => router.push(personalPaperHref(schoolId, paper.paperId))}
      emptyMessage={unfiltered ? 'No question papers yet. Create one from photos of a paper, a PDF or a description.' : 'No question papers match.'}
      emptyAction={unfiltered ? <CreatePaperButton schoolId={schoolId} variant="outline" /> : undefined}
    />
  );
}

/** The filter values the school's own papers state, as filter options. */
function usePaperFilters(schoolId: string): TableFilterConfig<keyof PaperFilters>[] {
  const options = useQuery(orpc.school.listStandalonePaperFilterOptions.queryOptions({ input: { schoolId } }));
  const toOptions = (values: readonly string[] | undefined) => (values ?? []).map((value) => ({ value, label: value }));
  return [
    { id: 'schoolName', label: 'School', type: 'single' as const, options: toOptions(options.data?.schoolNames) },
    { id: 'className', label: 'Class', type: 'single' as const, options: toOptions(options.data?.classNames) },
    { id: 'subjectName', label: 'Subject', type: 'single' as const, options: toOptions(options.data?.subjectNames) },
    { id: 'examName', label: 'Exam', type: 'single' as const, options: toOptions(options.data?.examNames) },
  ];
}

/**
 * The papers of a personal space (docs/personal-space.md): the standard
 * search and filter bars over a compact table, the filters built from the
 * details the papers state. Creating a paper opens it.
 */
export function StandalonePaperList({ schoolId }: { schoolId: string }) {
  // Every read of the list, its filter values included, waits behind the same gates as the procedures.
  return (
    <RequirePermissions permissions={standalonePaperPermission(schoolId, 'read')} fallback={<p className="text-sm text-muted-foreground">Your papers are unavailable for your account.</p>}>
      <QuestionPaperAssistantGate schoolId={schoolId}>
        <PaperListContent schoolId={schoolId} />
      </QuestionPaperAssistantGate>
    </RequirePermissions>
  );
}

/** The list itself, for someone who may read the papers and use the assistant. */
function PaperListContent({ schoolId }: { schoolId: string }) {
  const controller = useDataTableListState<'updatedAt', PaperFilters>({ defaultOrderBy: { field: 'updatedAt', direction: 'desc' } });
  const filters = usePaperFilters(schoolId);
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Question papers</h1>
          <p className="text-sm text-muted-foreground">Photograph a paper, attach a PDF or describe one, and the assistant types it up for you.</p>
        </div>
        <CreatePaperButton schoolId={schoolId} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TableSearchBar placeholder="Search school, class, subject or exam…" onSearchChange={controller.onSearchChange} />
        <TableFilterBar filters={filters} values={controller.query.filters ?? {}} onValuesChange={controller.onFiltersChange} />
      </div>
      <DataTableSuspense key={JSON.stringify(controller.query)} columnCount={6}>
        <PaperRows schoolId={schoolId} controller={controller} />
      </DataTableSuspense>
    </section>
  );
}
