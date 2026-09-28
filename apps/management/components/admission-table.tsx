'use client';

import type { AdmissionListItemDto } from '@campuspilot/api/routers/school/admission/admission.dto';
import { DataTable, DataTableSuspense, TableFilterBar, TableSearchBar, useDataTableListState, type DataTableColumnDef, type DataTableListController, type TableFilterConfig } from '@campuspilot/components/data-grid';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { orpc } from '@/lib/orpc';
import { useSchoolSessions, useStoredSchoolSessionId } from './session-selection';

type AdmissionFilters = { sessionId?: string; placementStatus?: 'assigned' | 'unassigned'; registrationStatus?: 'registered' | 'unregistered' };
type AdmissionController = DataTableListController<'name' | 'admissionNo' | 'dob' | 'createdAt', AdmissionFilters>;

function AdmissionRows({ schoolId, controller, sessionId, classLabels }: { schoolId: string; controller: AdmissionController; sessionId?: string; classLabels: Map<string, string> }) {
  const router = useRouter();
  const placementStatus = controller.query.filters?.placementStatus;
  const registrationStatus = controller.query.filters?.registrationStatus;
  const { data } = useSuspenseQuery(orpc.school.listAdmissions.queryOptions({ input: { schoolId, page: controller.query.page, limit: controller.query.limit, searchQuery: controller.query.searchQuery, orderBy: controller.query.orderBy, filters: { ...(sessionId ? { placementSessionId: sessionId, ...(placementStatus ? { placementStatus } : {}) } : {}), ...(registrationStatus ? { registered: registrationStatus === 'registered' } : {}) } } }));
  const columns: DataTableColumnDef<AdmissionListItemDto>[] = [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'admissionNo', header: 'Admission no.' },
    { id: 'class', header: 'Class', enableSorting: false, cell: ({ row }) => row.original.placement?.classId ? classLabels.get(row.original.placement.classId) ?? 'Unknown class' : 'Unassigned' },
    { accessorKey: 'fatherName', header: "Father's name", enableSorting: false },
  ];
  return <DataTable ariaLabel="Admissions" columns={columns} data={data.items} getRowId={(admission) => admission.id} manualPagination manualSorting onPaginationChange={controller.onPaginationChange} onSortingChange={controller.onSortingChange} pageCount={data.pagination.totalPages} rowCount={data.pagination.totalItems} showPagination state={controller.tableState} onRowClick={(admission) => router.push(`/school/${encodeURIComponent(schoolId)}/admission/${encodeURIComponent(admission.id)}/details`)} emptyMessage={controller.query.searchQuery ? 'No admissions match this search.' : 'No admissions match these filters.'} />;
}

export function AdmissionTable({ schoolId }: { schoolId: string }) {
  const sessionsQuery = useSchoolSessions(schoolId);
  const classesQuery = useQuery(orpc.school.listClasses.queryOptions({ input: { schoolId } }));
  const storedSessionId = useStoredSchoolSessionId(schoolId);
  const sessions = sessionsQuery.data ?? [];
  const defaultSessionId = storedSessionId ?? sessions.find(({ isActive }) => isActive)?.id ?? sessions[0]?.id;
  const controller = useDataTableListState<'name' | 'admissionNo' | 'dob' | 'createdAt', AdmissionFilters>({ defaultOrderBy: { field: 'name', direction: 'asc' }, defaultFilters: { registrationStatus: 'registered' } });
  const sessionId = controller.query.filters?.sessionId ?? defaultSessionId;
  const filters: TableFilterConfig<keyof AdmissionFilters>[] = [
    { id: 'sessionId', label: 'Session', type: 'single' as const, options: sessions.map((session) => ({ value: session.id, label: `${session.sessionStartYear}–${session.sessionEndYear}` })) },
    { id: 'placementStatus', label: 'Class status', type: 'single' as const, options: [{ value: 'assigned', label: 'Assigned' }, { value: 'unassigned', label: 'Unassigned' }] },
    { id: 'registrationStatus', label: 'Registration', type: 'single' as const, options: [{ value: 'registered', label: 'Registered' }, { value: 'unregistered', label: 'Unregistered' }] },
  ];
  const classLabels = new Map((classesQuery.data ?? []).map(({ id, label }) => [id, label]));
  const suspenseKey = JSON.stringify({ ...controller.query, sessionId });
  return <section className="mx-auto flex w-full max-w-7xl flex-col gap-5"><div><h1 className="text-2xl font-semibold tracking-tight">Admissions</h1><p className="text-sm text-muted-foreground">Search admission records and inspect their classroom placement by session.</p></div><div className="flex flex-wrap items-start justify-between gap-3"><TableSearchBar placeholder="Search name or admission number…" onSearchChange={controller.onSearchChange} /><TableFilterBar filters={filters} values={controller.query.filters ?? {}} onValuesChange={controller.onFiltersChange} /></div><DataTableSuspense key={suspenseKey} columnCount={4}><AdmissionRows schoolId={schoolId} controller={controller} sessionId={sessionId} classLabels={classLabels} /></DataTableSuspense></section>;
}
