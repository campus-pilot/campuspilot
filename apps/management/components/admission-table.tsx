'use client';

import type { AdmissionListItemDto } from '@campuspilot/api/routers/school/admission/admission.dto';
import { DataTable, DataTableSuspense, TableFilterBar, TableSearchBar, useDataTableListState, type DataTableColumnDef, type DataTableListController, type TableFilterConfig } from '@campuspilot/components/data-grid';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { orpc } from '@/lib/orpc';
import { isUnfilteredAdmissionList } from './admission-table-model';
import { CreateAdmissionAction } from './create-admission-action';
import { useSchoolFeature } from './require-feature';
import { useSchoolSessions, useStoredSchoolSessionId } from './session-selection';
import { WHATSAPP_READINESS_LABELS, WhatsappReadinessBadge, whatsappReadiness } from '@campuspilot/components/notifications';

type AdmissionFilters = { sessionId?: string; classId?: string; placementStatus?: 'assigned' | 'unassigned'; registrationStatus?: 'registered' | 'unregistered'; whatsappStatus?: 'ready' | 'needs_attention' | 'no_number' | 'not_verified' | 'no_consent' };
type AdmissionController = DataTableListController<'name' | 'admissionNo' | 'dob' | 'createdAt', AdmissionFilters>;

/**
 * Whether the table shows a guardian's WhatsApp readiness (its column and
 * its filter). They say which admissions need attention before a WhatsApp
 * message can reach them, which means nothing in a school that does not
 * send WhatsApp (the `whatsapp` feature), so they are hidden when the
 * school is known not to have it. While the flags are loading or could not
 * be read they stay: "unknown" is not "not enabled". The numbers and
 * consent themselves stay on the admission, for when the school has it.
 */
function useShowsWhatsappReadiness(schoolId: string): boolean {
  const whatsapp = useSchoolFeature(schoolId, 'whatsapp');
  return whatsapp.status !== 'ready' || whatsapp.enabled;
}

function AdmissionRows({ schoolId, controller, sessionId, classLabels, showWhatsapp }: { schoolId: string; controller: AdmissionController; sessionId?: string; classLabels: Map<string, string>; showWhatsapp: boolean }) {
  const router = useRouter();
  const unfiltered = isUnfilteredAdmissionList(controller.query);
  const placementStatus = controller.query.filters?.placementStatus;
  const registrationStatus = controller.query.filters?.registrationStatus;
  const classId = controller.query.filters?.classId;
  // A filter chosen before the column was hidden must not keep narrowing a list that no longer shows it.
  const whatsappStatus = showWhatsapp ? controller.query.filters?.whatsappStatus : undefined;
  const { data } = useSuspenseQuery(orpc.school.listAdmissions.queryOptions({ input: { schoolId, page: controller.query.page, limit: controller.query.limit, searchQuery: controller.query.searchQuery, orderBy: controller.query.orderBy, filters: { ...(sessionId ? { placementSessionId: sessionId, ...(placementStatus ? { placementStatus } : {}), ...(classId ? { placementClassId: classId } : {}) } : {}), ...(registrationStatus ? { registered: registrationStatus === 'registered' } : {}), ...(whatsappStatus ? { whatsappStatus } : {}) } } }));
  const columns: DataTableColumnDef<AdmissionListItemDto>[] = [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'admissionNo', header: 'Admission no.' },
    { id: 'class', header: 'Class', enableSorting: false, cell: ({ row }) => row.original.placement?.classId ? classLabels.get(row.original.placement.classId) ?? 'Unknown class' : 'Unassigned' },
    { accessorKey: 'fatherName', header: "Father's name", enableSorting: false },
    ...(showWhatsapp
      ? [{ id: 'whatsapp', header: 'WhatsApp', enableSorting: false, cell: ({ row }) => <WhatsappReadinessBadge readiness={whatsappReadiness(row.original)} /> } satisfies DataTableColumnDef<AdmissionListItemDto>]
      : []),
  ];
  return <DataTable ariaLabel="Admissions" columns={columns} data={data.items} getRowId={(admission) => admission.id} manualPagination manualSorting onPaginationChange={controller.onPaginationChange} onSortingChange={controller.onSortingChange} pageCount={data.pagination.totalPages} rowCount={data.pagination.totalItems} showPagination state={controller.tableState} onRowClick={(admission) => router.push(`/school/${encodeURIComponent(schoolId)}/admission/${encodeURIComponent(admission.id)}/details`)} emptyMessage={controller.query.searchQuery ? 'No admissions match this search.' : unfiltered ? 'No registered admissions yet.' : 'No admissions match these filters.'} emptyAction={unfiltered ? <CreateAdmissionAction schoolId={schoolId} variant="outline" /> : undefined} />;
}

export function AdmissionTable({ schoolId }: { schoolId: string }) {
  const sessionsQuery = useSchoolSessions(schoolId);
  const showWhatsapp = useShowsWhatsappReadiness(schoolId);
  const classesQuery = useQuery(orpc.school.listClasses.queryOptions({ input: { schoolId } }));
  const storedSessionId = useStoredSchoolSessionId(schoolId);
  const sessions = sessionsQuery.data ?? [];
  const defaultSessionId = storedSessionId ?? sessions.find(({ isActive }) => isActive)?.id ?? sessions[0]?.id;
  const controller = useDataTableListState<'name' | 'admissionNo' | 'dob' | 'createdAt', AdmissionFilters>({ defaultOrderBy: { field: 'name', direction: 'asc' }, defaultFilters: { registrationStatus: 'registered' } });
  const sessionId = controller.query.filters?.sessionId ?? defaultSessionId;
  const filters: TableFilterConfig<keyof AdmissionFilters>[] = [
    { id: 'sessionId', label: 'Session', type: 'single' as const, options: sessions.map((session) => ({ value: session.id, label: `${session.sessionStartYear}–${session.sessionEndYear}` })) },
    { id: 'classId', label: 'Class', type: 'single' as const, options: (classesQuery.data ?? []).map(({ id, label }) => ({ value: id, label })) },
    { id: 'placementStatus', label: 'Class status', type: 'single' as const, options: [{ value: 'assigned', label: 'Assigned' }, { value: 'unassigned', label: 'Unassigned' }] },
    { id: 'registrationStatus', label: 'Registration', type: 'single' as const, options: [{ value: 'registered', label: 'Registered' }, { value: 'unregistered', label: 'Unregistered' }] },
    ...(showWhatsapp ? [{ id: 'whatsappStatus' as const, label: 'WhatsApp', type: 'single' as const, options: [{ value: 'needs_attention', label: 'Needs attention' }, { value: 'not_verified', label: WHATSAPP_READINESS_LABELS.not_verified }, { value: 'no_consent', label: WHATSAPP_READINESS_LABELS.no_consent }, { value: 'no_number', label: WHATSAPP_READINESS_LABELS.no_number }, { value: 'ready', label: WHATSAPP_READINESS_LABELS.ready }] }] : []),
  ];
  const classLabels = new Map((classesQuery.data ?? []).map(({ id, label }) => [id, label]));
  const suspenseKey = JSON.stringify({ ...controller.query, sessionId });
  return <section className="mx-auto flex w-full max-w-7xl flex-col gap-5"><div><h1 className="text-2xl font-semibold tracking-tight">Admissions</h1><p className="text-sm text-muted-foreground">Search admission records and inspect their classroom placement by session.</p></div><div className="flex flex-wrap items-start justify-between gap-3"><TableSearchBar placeholder="Search name or admission number…" onSearchChange={controller.onSearchChange} /><TableFilterBar filters={filters} values={controller.query.filters ?? {}} onValuesChange={controller.onFiltersChange} /></div><DataTableSuspense key={suspenseKey} columnCount={showWhatsapp ? 5 : 4}><AdmissionRows schoolId={schoolId} controller={controller} sessionId={sessionId} classLabels={classLabels} showWhatsapp={showWhatsapp} /></DataTableSuspense></section>;
}
