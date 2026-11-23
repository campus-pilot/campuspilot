'use client';

import { useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { SchoolRegistrationRequestDto } from '@campuspilot/api/routers/system-admin/school-registration-request/school-registration-request.dto';
import {
  DataTable,
  DataTableSuspense,
  TableSearchBar,
  useDataTableListState,
  type DataTableColumnDef,
  type DataTableListController,
} from '@campuspilot/components/data-grid';
import { Badge } from '@campuspilot/ui/components/badge';
import { orpc } from '@/lib/orpc';
import { classAnswers, textAnswer } from './onboarding-answers';
import { SchoolOnboardingDialog } from './school-onboarding-dialog';

type OrderField = 'createdAt';
type Controller = DataTableListController<OrderField, Record<string, never>>;

const dateTimeFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

function Files({ request }: { request: SchoolRegistrationRequestDto }) {
  if (!request.logo && !request.voiceNote) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex gap-1">
      {request.logo ? <Badge variant="outline">Logo</Badge> : null}
      {request.voiceNote ? <Badge variant="outline">Voice note</Badge> : null}
    </span>
  );
}

const SETUP_LABELS = { draft: 'Draft', queued: 'Queued', running: 'Running', succeeded: 'Set up', failed: 'Failed' } as const;

function SetupStatus({ request }: { request: SchoolRegistrationRequestDto }) {
  if (!request.setup) return <span className="text-muted-foreground">Not started</span>;
  const { status } = request.setup;
  return <Badge variant={status === 'failed' ? 'destructive' : status === 'succeeded' ? 'secondary' : 'outline'}>{SETUP_LABELS[status]}</Badge>;
}

const columns: DataTableColumnDef<SchoolRegistrationRequestDto>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Received',
    enableSorting: false,
    cell: ({ row }) => dateTimeFormatter.format(row.original.createdAt),
  },
  {
    id: 'school',
    header: 'School',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex min-w-48 flex-col gap-0.5">
        <span className="truncate font-medium">{textAnswer(row.original, 'schoolName') ?? '—'}</span>
        <span className="truncate text-xs text-muted-foreground">{textAnswer(row.original, 'email') ?? 'No email'}</span>
      </span>
    ),
  },
  { id: 'phone', header: 'Phone', enableSorting: false, cell: ({ row }) => textAnswer(row.original, 'phone') ?? '—' },
  { id: 'classes', header: 'Classes', enableSorting: false, cell: ({ row }) => classAnswers(row.original).length },
  { id: 'files', header: 'Files', enableSorting: false, cell: ({ row }) => <Files request={row.original} /> },
  { id: 'setup', header: 'Setup', enableSorting: false, cell: ({ row }) => <SetupStatus request={row.original} /> },
];

function RequestRows({ controller, onSelect }: { controller: Controller; onSelect: (request: SchoolRegistrationRequestDto) => void }) {
  const { data } = useSuspenseQuery(
    orpc.systemAdmin.listSchoolRegistrationRequests.queryOptions({
      input: { page: controller.query.page, limit: controller.query.limit, searchQuery: controller.query.searchQuery },
    }),
  );
  return (
    <DataTable
      ariaLabel="School onboarding submissions"
      columns={columns}
      data={data.items}
      getRowId={(row) => row.id}
      manualPagination
      manualSorting
      onPaginationChange={controller.onPaginationChange}
      onSortingChange={controller.onSortingChange}
      onRowClick={onSelect}
      pageCount={data.pagination.totalPages}
      rowCount={data.pagination.totalItems}
      showPagination
      state={controller.tableState}
      emptyMessage="No school onboarding forms yet."
    />
  );
}

/** The admin app's School onboarding page: submissions of the website's /onboarding form, newest first. */
export function SchoolOnboardingTable() {
  const controller = useDataTableListState<OrderField, Record<string, never>>({
    defaultOrderBy: { field: 'createdAt', direction: 'desc' },
  });
  const [selected, setSelected] = useState<SchoolRegistrationRequestDto | null>(null);
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">School onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Submissions of the website&apos;s School Onboarding form. Open one to see its classes, notes, logo and voice note.
        </p>
      </div>
      <TableSearchBar placeholder="Search school, phone, email or address…" onSearchChange={controller.onSearchChange} />
      <DataTableSuspense key={JSON.stringify(controller.query)} columnCount={columns.length}>
        <RequestRows controller={controller} onSelect={setSelected} />
      </DataTableSuspense>
      <SchoolOnboardingDialog request={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
