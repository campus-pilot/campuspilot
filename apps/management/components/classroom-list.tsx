"use client";

import type { ClassDto } from "@campuspilot/api/routers/school/class/class.dto";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SortableTable,
  type SortableTableColumn,
} from "@campuspilot/components/sortable-table";
import { Skeleton } from "@campuspilot/ui/components/skeleton";
import { BookOpen, GraduationCap, Layers3, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { client, orpc } from "@/lib/orpc";
import { RequirePermissions } from "./require-permissions";

type ClassSummary = Awaited<
  ReturnType<typeof client.school.listClasses>
>[number];

const columns: SortableTableColumn<ClassSummary>[] = [
  {
    id: "class",
    header: "Class",
    className: "min-w-52",
    cell: (schoolClass) => (
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <GraduationCap className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{schoolClass.label}</span>
          <span className="truncate text-xs text-muted-foreground">
            {schoolClass.slug}
          </span>
        </div>
      </div>
    ),
  },
  {
    id: "sections",
    header: "Sections",
    cell: (schoolClass) => (
      <span className="inline-flex items-center gap-1.5">
        <Layers3 className="size-3.5 text-muted-foreground" aria-hidden />
        {schoolClass.sectionCount}
      </span>
    ),
  },
  {
    id: "teachers",
    header: "Teachers",
    cell: (schoolClass) => (
      <span className="inline-flex items-center gap-1.5">
        <Users className="size-3.5 text-muted-foreground" aria-hidden />
        {schoolClass.teacherCount}
      </span>
    ),
  },
  {
    id: "students",
    header: "Students",
    cell: (schoolClass) =>
      schoolClass.studentCount === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        schoolClass.studentCount
      ),
  },
  {
    id: "subjects",
    header: "Subjects",
    cell: (schoolClass) => (
      <span className="inline-flex items-center gap-1.5">
        <BookOpen className="size-3.5 text-muted-foreground" aria-hidden />
        {schoolClass.subjectCount}
      </span>
    ),
  },
];

function ClassroomTable({
  canReorder,
  classes,
  onReorder,
  onRowClick,
  reorderPending,
}: {
  canReorder: boolean;
  classes: ClassSummary[];
  onReorder: (classes: ClassSummary[]) => void;
  onRowClick: (schoolClass: ClassDto) => void;
  reorderPending: boolean;
}) {
  return (
    <SortableTable
      ariaLabel="School classrooms"
      columns={columns}
      data={classes}
      emptyMessage="No classrooms have been created yet."
      getRowId={(schoolClass) => schoolClass.id}
      getRowLabel={(schoolClass) => schoolClass.label}
      onReorder={canReorder ? onReorder : undefined}
      onRowClick={onRowClick}
      reorderDisabled={reorderPending}
    />
  );
}

export function ClassroomList({
  schoolId,
  sessionId,
}: {
  schoolId: string;
  sessionId: string;
}) {
  return (
    <RequirePermissions
      permissions={[
        SCHOOL_ACTIONS.LIST_CLASSES,
        SCHOOL_ACTIONS.READ_SESSION,
      ].map((action) => ({
        action,
        resource: { kind: "school" as const, schoolId },
      }))}
      fallback={
        <p className="text-sm text-muted-foreground">
          Classroom access is unavailable.
        </p>
      }
    >
      <ClassroomListContent schoolId={schoolId} sessionId={sessionId} />
    </RequirePermissions>
  );
}
function ClassroomListContent({
  schoolId,
  sessionId,
}: {
  schoolId: string;
  sessionId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queryOptions = orpc.school.listClasses.queryOptions({
    input: { schoolId, sessionId },
  });
  const classesQuery = useQuery(queryOptions);
  const reorderMutation = useMutation({
    mutationFn: (classes: ClassSummary[]) =>
      client.school.reorderClasses({
        schoolId,
        orderedClassIds: classes.map(({ id }) => id),
      }),
    onMutate: async (classes) => {
      await queryClient.cancelQueries({ queryKey: queryOptions.queryKey });
      const previous = queryClient.getQueryData<ClassSummary[]>(
        queryOptions.queryKey,
      );
      queryClient.setQueryData(
        queryOptions.queryKey,
        classes.map((schoolClass, index) => ({
          ...schoolClass,
          displayOrder: index + 1,
        })),
      );
      return { previous };
    },
    onError: (_error, _classes, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryOptions.queryKey, context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
    },
  });

  if (classesQuery.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (classesQuery.isError) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Unable to load classrooms.
      </p>
    );
  }

  const classes = classesQuery.data;
  const openClass = (schoolClass: ClassDto) =>
    router.push(
      `/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/classroom/${encodeURIComponent(schoolClass.id)}/students`,
    );

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Classrooms</h1>
        <p className="text-sm text-muted-foreground">
          Organize classes in their academic progression. Drag rows to change
          the display order.
        </p>
      </div>
      <RequirePermissions
        permissions={{
          action: SCHOOL_ACTIONS.REORDER_CLASSES,
          resource: { kind: "school", schoolId },
        }}
        fallback={
          <ClassroomTable
            canReorder={false}
            classes={classes}
            onReorder={() => undefined}
            onRowClick={openClass}
            reorderPending={false}
          />
        }
      >
        <ClassroomTable
          canReorder
          classes={classes}
          onReorder={(nextClasses) => reorderMutation.mutate(nextClasses)}
          onRowClick={openClass}
          reorderPending={reorderMutation.isPending}
        />
      </RequirePermissions>
      {reorderMutation.error ? (
        <p className="text-xs text-destructive">
          {reorderMutation.error instanceof Error
            ? reorderMutation.error.message
            : "Unable to reorder classrooms."}
        </p>
      ) : null}
    </section>
  );
}
