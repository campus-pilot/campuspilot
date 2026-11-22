'use client';

import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
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
import { DemoSchoolJobStatus } from './demo-school/demo-school-job-status';
import { SchoolAvatar } from './school-avatar';
import { SchoolBadges } from './school-badges';

type OrganizationOrderField = 'name' | 'location' | 'createdAt' | 'updatedAt';
/** `plan`: schools in an active billing period of a kind, or schools without a plan (docs/school-billing.md). */
/** `kind`: real schools or personal spaces (docs/personal-space.md). */
type OrganizationFilters = { plan?: 'trial' | 'paid' | 'complimentary' | 'none'; kind?: 'school' | 'personal' };
type OrganizationListController = DataTableListController<
  OrganizationOrderField,
  OrganizationFilters
>;

const organizationFilters: TableFilterConfig<keyof OrganizationFilters>[] = [
  {
    id: 'plan',
    label: 'Plan',
    type: 'single',
    options: [
      { value: 'trial', label: 'On a trial' },
      { value: 'paid', label: 'Paid period' },
      { value: 'complimentary', label: 'Free period' },
      { value: 'none', label: 'No plan' },
    ],
  },
  {
    id: 'kind',
    label: 'Kind',
    type: 'single',
    options: [
      { value: 'school', label: 'Schools' },
      { value: 'personal', label: 'Personal spaces' },
    ],
  },
];

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
});

const organizationColumns: DataTableColumnDef<SchoolDto>[] = [
  {
    accessorKey: 'name',
    header: 'Organization',
    cell: ({ row }) => {
      return (
        <Link
          href={`/school/${row.original.id}`}
          className="group flex min-w-56 items-center gap-2.5"
        >
          <SchoolAvatar school={row.original} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium underline decoration-border underline-offset-4 group-hover:decoration-foreground">
                {row.original.name}
              </span>
              <SchoolBadges school={row.original} />
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {row.original.slug}
            </span>
          </span>
        </Link>
      );
    },
  },
  {
    accessorKey: 'location',
    header: 'Location',
  },
  {
    id: 'registrationNo',
    accessorKey: 'registrationNo',
    header: 'Registration',
    enableSorting: false,
    cell: ({ row }) => row.original.registrationNo ?? '—',
  },
  {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    // Demo rows always show their seeding job's own status (which reads
    // "Onboarded" once it succeeded); other rows show onboarding.
    cell: ({ row }) =>
      row.original.isDemo ? (
        <DemoSchoolJobStatus schoolId={row.original.id} />
      ) : (
        <Badge
          variant={row.original.hasCompletedOnboarding ? 'secondary' : 'outline'}
        >
          {row.original.hasCompletedOnboarding ? 'Onboarded' : 'Setup pending'}
        </Badge>
      ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) =>
      row.original.createdAt
        ? dateFormatter.format(row.original.createdAt)
        : '—',
  },
];

function OrganizationRows({
  controller,
}: {
  controller: OrganizationListController;
}) {
  const { data } = useSuspenseQuery(
    orpc.systemAdmin.listSchools.queryOptions({
      input: {
        page: controller.query.page,
        limit: controller.query.limit,
        searchQuery: controller.query.searchQuery,
        orderBy: controller.query.orderBy,
        filters:
          controller.query.filters?.plan || controller.query.filters?.kind
            ? {
                ...(controller.query.filters.plan ? { plan: controller.query.filters.plan } : {}),
                ...(controller.query.filters.kind ? { kind: controller.query.filters.kind } : {}),
              }
            : undefined,
      },
    }),
  );

  return (
    <DataTable
      ariaLabel="Organizations"
      columns={organizationColumns}
      data={data.items}
      getRowId={(school) => school.id}
      manualPagination
      manualSorting
      onPaginationChange={controller.onPaginationChange}
      onSortingChange={controller.onSortingChange}
      pageCount={data.pagination.totalPages}
      rowCount={data.pagination.totalItems}
      showPagination
      state={controller.tableState}
      emptyMessage={
        controller.query.searchQuery || controller.query.filters?.plan || controller.query.filters?.kind
          ? 'No organizations match this search.'
          : 'No organizations have been added yet.'
      }
    />
  );
}

export function OrganizationsTable() {
  const controller = useDataTableListState<OrganizationOrderField, OrganizationFilters>({
    defaultOrderBy: { field: 'name', direction: 'asc' },
  });
  const suspenseKey = JSON.stringify(controller.query);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        <p className="text-sm text-muted-foreground">
          Browse and manage the schools on CampusPilot.
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TableSearchBar
          placeholder="Search organizations…"
          onSearchChange={controller.onSearchChange}
        />
        <TableFilterBar
          filters={organizationFilters}
          values={controller.query.filters ?? {}}
          onValuesChange={controller.onFiltersChange}
        />
      </div>
      <DataTableSuspense
        key={suspenseKey}
        columnCount={organizationColumns.length}
      >
        <OrganizationRows controller={controller} />
      </DataTableSuspense>
    </section>
  );
}
