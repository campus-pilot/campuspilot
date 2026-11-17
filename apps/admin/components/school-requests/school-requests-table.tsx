'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { SchoolCreationRequestDto } from '@campuspilot/api/routers/system-admin/school-creation-request/school-creation-request.dto';
import {
  DataTable,
  DataTableSuspense,
  TableFilterBar,
  useDataTableListState,
  type DataTableColumnDef,
  type DataTableListController,
  type TableFilterConfig,
} from '@campuspilot/components/data-grid';
import { staffSignInLabel } from '@campuspilot/components/staff-account/staff-sign-in-label';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { orpc } from '@/lib/orpc';
import { DecideSchoolRequestDialog, type SchoolRequestDecision } from './decide-school-request-dialog';

type RequestFilters = { status?: 'pending' | 'approved' | 'rejected' };
type RequestListController = DataTableListController<'createdAt', RequestFilters>;
type OpenDecision = { request: SchoolCreationRequestDto; decision: SchoolRequestDecision };

const requestFilters: TableFilterConfig<keyof RequestFilters>[] = [
  {
    id: 'status',
    label: 'Status',
    type: 'single',
    options: [
      { value: 'pending', label: 'Pending' },
      { value: 'approved', label: 'Approved' },
      { value: 'rejected', label: 'Rejected' },
    ],
  },
];

const dateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });

function StatusBadge({ request }: { request: SchoolCreationRequestDto }) {
  if (request.status === 'pending') return <Badge variant="outline">Pending</Badge>;
  if (request.status === 'approved') return <Badge variant="secondary">Approved · {request.grantedLimit}</Badge>;
  return <Badge variant="destructive">Rejected</Badge>;
}

function CreatedSchools({ request }: { request: SchoolCreationRequestDto }) {
  if (request.createdSchools.length === 0) return <span className="text-muted-foreground">None yet</span>;
  return (
    <div className="flex min-w-40 flex-wrap gap-1">
      {request.createdSchools.map((school, index) =>
        school.schoolId ? (
          <Badge key={school.schoolId} variant="outline" asChild>
            <Link href={`/school/${school.schoolId}`}>{school.name}</Link>
          </Badge>
        ) : (
          <Badge key={`deleted-${index}`} variant="outline" className="text-muted-foreground">
            Deleted school
          </Badge>
        ),
      )}
    </div>
  );
}

function createRequestColumns(onDecide: (open: OpenDecision) => void): DataTableColumnDef<SchoolCreationRequestDto>[] {
  return [
    {
      id: 'person',
      header: 'Person',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex min-w-44 flex-col gap-0.5">
          <span className="font-medium">{row.original.name.trim() || staffSignInLabel(row.original)}</span>
          <span className="text-xs text-muted-foreground">{staffSignInLabel(row.original)}</span>
        </div>
      ),
    },
    {
      id: 'limit',
      header: 'Asked for',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.requestedLimit} schools <span className="text-muted-foreground">(now {row.original.currentLimit})</span>
        </span>
      ),
    },
    {
      id: 'reason',
      header: 'Why',
      enableSorting: false,
      cell: ({ row }) => (
        <p className="max-w-md min-w-60 text-sm whitespace-pre-line">{row.original.reason}</p>
      ),
    },
    {
      id: 'createdSchools',
      header: 'Schools created',
      enableSorting: false,
      cell: ({ row }) => <CreatedSchools request={row.original} />,
    },
    {
      accessorKey: 'createdAt',
      header: 'Asked on',
      cell: ({ row }) => dateFormatter.format(row.original.createdAt),
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => <StatusBadge request={row.original} />,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.status === 'pending' ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onDecide({ request: row.original, decision: 'approve' })}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDecide({ request: row.original, decision: 'reject' })}>
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];
}

function RequestRows({ controller }: { controller: RequestListController }) {
  const [open, setOpen] = useState<OpenDecision>();
  const { data } = useSuspenseQuery(
    orpc.systemAdmin.listSchoolCreationRequests.queryOptions({
      input: {
        page: controller.query.page,
        limit: controller.query.limit,
        status: controller.query.filters?.status,
      },
    }),
  );
  return (
    <>
      <DataTable
        ariaLabel="School requests"
        columns={createRequestColumns(setOpen)}
        data={data.items}
        getRowId={(request) => request.id}
        manualPagination
        manualSorting
        onPaginationChange={controller.onPaginationChange}
        onSortingChange={controller.onSortingChange}
        pageCount={data.pagination.totalPages}
        rowCount={data.pagination.totalItems}
        showPagination
        state={controller.tableState}
        emptyMessage={controller.query.filters?.status === 'pending' ? 'No requests are waiting.' : 'No requests.'}
      />
      {open ? (
        <DecideSchoolRequestDialog
          key={`${open.request.id}-${open.decision}`}
          request={open.request}
          decision={open.decision}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
    </>
  );
}

/**
 * Requests from staff to create more schools than their allowance
 * (docs/school-creation.md), newest first and pending by default. Approving
 * sets the person's allowance to the granted total.
 */
export function SchoolRequestsTable() {
  const controller = useDataTableListState<'createdAt', RequestFilters>({
    defaultOrderBy: { field: 'createdAt', direction: 'desc' },
    defaultFilters: { status: 'pending' },
  });
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">School requests</h1>
        <p className="text-sm text-muted-foreground">
          Everyone may create one school of their own. Approve a request to let someone create more.
        </p>
      </div>
      <TableFilterBar
        filters={requestFilters}
        values={controller.query.filters ?? {}}
        onValuesChange={controller.onFiltersChange}
      />
      <DataTableSuspense key={JSON.stringify(controller.query)} columnCount={7}>
        <RequestRows controller={controller} />
      </DataTableSuspense>
    </section>
  );
}
