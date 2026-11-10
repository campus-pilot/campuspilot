'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { NoticeSummaryDto } from '@campuspilot/api/routers/school/notice/notice.dto';
import { DataTable, DataTableSuspense, TableFilterBar, TableSearchBar, useDataTableListState, type DataTableColumnDef, type DataTableListController, type TableFilterConfig } from '@campuspilot/components/data-grid';
import { NOTICE_STATUS_LABELS, NoticeStatusBadge, noticeAudienceLabel } from '@campuspilot/components/notices';
import { Button } from '@campuspilot/ui/components/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@campuspilot/ui/components/empty';

import { orpc } from '@/lib/orpc';
import { noticeHref } from '../notifications/notification-routes';
import { RequireFeature } from '../require-feature';
import { RequirePermissions } from '../require-permissions';
import { newNoticeHref, noticeAudienceFilterOptions, noticeListApiFilters, type NoticeListFilters, type NoticeSessionScope } from './notice-model';

type NoticeOrderField = 'createdAt' | 'publishedAt' | 'title';
type NoticeController = DataTableListController<NoticeOrderField, NoticeListFilters>;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * "New notice", for staff who may draft in a school that has notices. The
 * list page shows it in the navbar and again inside its empty state.
 */
export function NewNoticeAction({ scope, variant = 'default' }: { scope: NoticeSessionScope; variant?: 'default' | 'outline' }) {
  return (
    <RequireFeature schoolId={scope.schoolId} feature="notices">
      <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.DRAFT_NOTICE, resource: { kind: 'school', schoolId: scope.schoolId } }}>
        <Button asChild size="sm" variant={variant}>
          <Link href={newNoticeHref(scope)}><Plus aria-hidden />New notice</Link>
        </Button>
      </RequirePermissions>
    </RequireFeature>
  );
}

function NoNoticesYet({ scope }: { scope: NoticeSessionScope }) {
  return (
    <Empty className="border border-dashed p-10">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Megaphone /></EmptyMedia>
        <EmptyTitle>No notices yet</EmptyTitle>
        <EmptyDescription>Write a notice for staff, students or both. It stays a draft until a principal or manager publishes it.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><NewNoticeAction scope={scope} variant="outline" /></EmptyContent>
    </Empty>
  );
}

function noticeColumns(): DataTableColumnDef<NoticeSummaryDto>[] {
  return [
    { accessorKey: 'title', header: 'Title', cell: ({ row }) => <span className="block max-w-[28rem] truncate font-medium">{row.original.title}</span> },
    { id: 'audience', header: 'Audience', enableSorting: false, cell: ({ row }) => noticeAudienceLabel(row.original, row.original.classes.map((entry) => entry.name)) },
    { id: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <NoticeStatusBadge status={row.original.status} /> },
    { id: 'author', header: 'Written by', enableSorting: false, cell: ({ row }) => row.original.createdByName ?? 'Former staff member' },
    { accessorKey: 'publishedAt', header: 'Published', cell: ({ row }) => (row.original.publishedAt ? dateFormat.format(row.original.publishedAt) : '—') },
  ];
}

/**
 * One page of notices. A session with no notice at all (no search, no
 * filter) shows the invitation to write the first one instead of an empty
 * table; a search or filter without matches keeps the table and says so.
 */
function NoticeRows({ scope, controller }: { scope: NoticeSessionScope; controller: NoticeController }) {
  const router = useRouter();
  const { query } = controller;
  const filters = noticeListApiFilters(query.filters);
  const { data } = useSuspenseQuery(orpc.school.listNotices.queryOptions({ input: { ...scope, page: query.page, limit: query.limit, searchQuery: query.searchQuery ?? '', orderBy: query.orderBy, filters } }));
  const unfiltered = !query.searchQuery && Object.keys(filters).length === 0;
  if (unfiltered && data.pagination.totalItems === 0) return <NoNoticesYet scope={scope} />;
  return (
    <DataTable
      ariaLabel="Notices"
      columns={noticeColumns()}
      data={data.items}
      getRowId={(notice) => notice.id}
      manualPagination
      manualSorting
      onPaginationChange={controller.onPaginationChange}
      onSortingChange={controller.onSortingChange}
      pageCount={data.pagination.totalPages}
      rowCount={data.pagination.totalItems}
      showPagination
      state={controller.tableState}
      onRowClick={(notice) => router.push(noticeHref(scope.schoolId, scope.sessionId, notice.id))}
      emptyMessage={query.searchQuery ? 'No notices match this search.' : 'No notices match these filters.'}
    />
  );
}

function NoticeListHeader() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Notices</h1>
      <p className="text-sm text-muted-foreground">Notices of this session: published ones, and the drafts you can work on.</p>
    </div>
  );
}

/** The session's notices: every published notice, plus the caller's drafts (all drafts for staff who may publish). */
export function NoticeList({ scope }: { scope: NoticeSessionScope }) {
  const controller = useDataTableListState<NoticeOrderField, NoticeListFilters>({ defaultOrderBy: { field: 'createdAt', direction: 'desc' } });
  const filters: TableFilterConfig<keyof NoticeListFilters>[] = [
    { id: 'status', label: 'Status', type: 'single', options: (['draft', 'published'] as const).map((value) => ({ value, label: NOTICE_STATUS_LABELS[value] })) },
    { id: 'audience', label: 'Audience', type: 'single', options: noticeAudienceFilterOptions() },
  ];
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <NoticeListHeader />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TableSearchBar placeholder="Search notice titles…" onSearchChange={controller.onSearchChange} />
        <TableFilterBar filters={filters} values={controller.query.filters ?? {}} onValuesChange={controller.onFiltersChange} />
      </div>
      <DataTableSuspense key={JSON.stringify(controller.query)} columnCount={5}>
        <NoticeRows scope={scope} controller={controller} />
      </DataTableSuspense>
    </section>
  );
}
