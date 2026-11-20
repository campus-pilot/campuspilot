'use client';

import { useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { LeadDto } from '@campuspilot/api/routers/system-admin/lead/lead.dto';
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
import { Badge } from '@campuspilot/ui/components/badge';
import { orpc } from '@/lib/orpc';
import { LeadDetailDialog } from './lead-detail-dialog';
import { alertStatusLabels, alertStatusVariants, answer, answerText, type LeadAlertStatus } from './lead-labels';

type OrderField = 'createdAt';
type Filters = { alertStatus?: LeadAlertStatus };
type Controller = DataTableListController<OrderField, Filters>;

const dateTimeFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

const filters: TableFilterConfig<keyof Filters>[] = [
  {
    id: 'alertStatus',
    label: 'WhatsApp alert',
    type: 'single',
    options: (Object.keys(alertStatusLabels) as LeadAlertStatus[]).map((value) => ({ value, label: alertStatusLabels[value] })),
  },
];

const columns: DataTableColumnDef<LeadDto>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Received',
    enableSorting: false,
    cell: ({ row }) => dateTimeFormatter.format(row.original.createdAt),
  },
  {
    id: 'name',
    header: 'Name',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex min-w-40 flex-col gap-0.5">
        <span className="truncate font-medium">{answer(row.original, 'name') ?? '—'}</span>
        <span className="truncate text-xs text-muted-foreground">{answer(row.original, 'schoolName') ?? 'School not given'}</span>
      </span>
    ),
  },
  { id: 'phone', header: 'Phone', enableSorting: false, cell: ({ row }) => answer(row.original, 'phone') ?? '—' },
  {
    id: 'size',
    header: 'Students / staff',
    enableSorting: false,
    cell: ({ row }) => `${answerText(row.original.response.approxStudents)} / ${answerText(row.original.response.approxStaff)}`,
  },
  {
    id: 'alertStatus',
    header: 'WhatsApp alert',
    enableSorting: false,
    cell: ({ row }) => <Badge variant={alertStatusVariants[row.original.alertStatus]}>{alertStatusLabels[row.original.alertStatus]}</Badge>,
  },
];

function LeadRows({ controller, onSelect }: { controller: Controller; onSelect: (lead: LeadDto) => void }) {
  const { data } = useSuspenseQuery(
    orpc.systemAdmin.listLeads.queryOptions({
      input: {
        page: controller.query.page,
        limit: controller.query.limit,
        searchQuery: controller.query.searchQuery,
        filters: controller.query.filters?.alertStatus ? { alertStatus: controller.query.filters.alertStatus } : {},
      },
    }),
  );
  return (
    <DataTable
      ariaLabel="Demo requests"
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
      emptyMessage="No demo requests yet."
    />
  );
}

/** The admin app's Demo requests page: leads from the website form, newest first. */
export function LeadsTable() {
  const controller = useDataTableListState<OrderField, Filters>({
    defaultOrderBy: { field: 'createdAt', direction: 'desc' },
  });
  const [selected, setSelected] = useState<LeadDto | null>(null);
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Demo requests</h1>
        <p className="text-sm text-muted-foreground">
          Requests from the website&apos;s Book a demo form. Open one to see every answer and its WhatsApp alert.
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TableSearchBar placeholder="Search name, phone, email or school…" onSearchChange={controller.onSearchChange} />
        <TableFilterBar filters={filters} values={controller.query.filters ?? {}} onValuesChange={controller.onFiltersChange} />
      </div>
      <DataTableSuspense key={JSON.stringify(controller.query)} columnCount={columns.length}>
        <LeadRows controller={controller} onSelect={setSelected} />
      </DataTableSuspense>
      <LeadDetailDialog lead={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
