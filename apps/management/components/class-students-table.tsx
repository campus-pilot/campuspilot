'use client';

import type { StudentDto } from '@campuspilot/api/routers/school/student/student.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { DataTable, DataTableSuspense, TableFilterBar, TableSearchBar, useDataTableListState, type DataTableColumnDef, type DataTableListController, type TableFilterConfig } from '@campuspilot/components/data-grid';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { orpc } from '@/lib/orpc';

type Filters = { sectionId?: string };
type Controller = DataTableListController<'name' | 'admissionNo' | 'rollNo' | 'createdAt', Filters>;

function StudentRows({ schoolId, sessionId, classId, controller, sections }: { schoolId: string; sessionId: string; classId: string; controller: Controller; sections: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const { data } = useSuspenseQuery(orpc.school.listStudents.queryOptions({ input: { schoolId, sessionId, page: controller.query.page, limit: controller.query.limit, searchQuery: controller.query.searchQuery, orderBy: controller.query.orderBy, filters: { classId, sectionId: controller.query.filters?.sectionId } } }));
  const columns: DataTableColumnDef<StudentDto>[] = [
    { id: 'name', accessorFn: (student) => student.admission.name, header: 'Student', cell: ({ row }) => <span className="font-medium">{row.original.admission.name}</span> },
    { id: 'admissionNo', accessorFn: (student) => student.admission.admissionNo, header: 'Admission no.' },
    { accessorKey: 'rollNo', header: 'Roll no.', cell: ({ row }) => row.original.rollNo ?? '—' },
    { accessorKey: 'sectionId', header: 'Section', enableSorting: false, cell: ({ row }) => <Badge variant="secondary">{sections.find(({ id }) => id === row.original.sectionId)?.label ?? 'Unassigned'}</Badge> },
  ];
  return <DataTable ariaLabel="Class students" columns={columns} data={data.items} getRowId={(student) => student.id} manualPagination manualSorting onPaginationChange={controller.onPaginationChange} onSortingChange={controller.onSortingChange} pageCount={data.pagination.totalPages} rowCount={data.pagination.totalItems} showPagination state={controller.tableState} onRowClick={(student) => router.push(`/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/classroom/${encodeURIComponent(classId)}/students/${encodeURIComponent(student.id)}`)} emptyMessage={controller.query.searchQuery ? 'No students match this search.' : 'No students are assigned to this classroom.'} />;
}

export function ClassStudentsTable({ schoolId, sessionId, classId }: { schoolId: string; sessionId: string; classId: string }) {
  const sectionsQuery = useQuery(orpc.school.listSections.queryOptions({ input: { schoolId, classId } }));
  const controller = useDataTableListState<'name' | 'admissionNo' | 'rollNo' | 'createdAt', Filters>({ defaultOrderBy: { field: 'rollNo', direction: 'asc' } });
  const filters: TableFilterConfig<'sectionId'>[] = [{ id: 'sectionId', label: 'Section', type: 'single', options: (sectionsQuery.data ?? []).map((section) => ({ value: section.id, label: section.label })) }];
  return <section className="flex flex-col gap-5"><div><h2 className="text-lg font-semibold">Students</h2><p className="text-sm text-muted-foreground">Students assigned to this classroom in the selected session.</p></div><div className="flex flex-wrap items-start justify-between gap-3"><TableSearchBar placeholder="Search name or admission number…" onSearchChange={controller.onSearchChange} /><TableFilterBar filters={filters} values={controller.query.filters ?? {}} onValuesChange={controller.onFiltersChange} /></div><DataTableSuspense key={JSON.stringify(controller.query)} columnCount={4}><StudentRows schoolId={schoolId} sessionId={sessionId} classId={classId} controller={controller} sections={sectionsQuery.data ?? []} /></DataTableSuspense></section>;
}
