'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { SchoolSessionDto } from '@campuspilot/api/routers/school/session/session.dto';
import {
  DataTable,
  DataTableSuspense,
  TableFilterBar,
  useDataTableListState,
  type DataTableColumnDef,
  type DataTableListController,
  type TableFilterConfig,
} from '@campuspilot/components/data-grid';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { schoolHref } from '@/components/school-route';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import { CreateSessionDialog } from './create-session-dialog';

type SessionOrderField =
  | 'sessionStartYear'
  | 'sessionEndYear'
  | 'createdAt'
  | 'updatedAt';

type SessionFilters = {
  startYears?: number[];
  endYears?: number[];
};

type SessionListController = DataTableListController<
  SessionOrderField,
  SessionFilters
>;

function sessionDetailHref(schoolId: string, sessionId: string) {
  return schoolHref(schoolId, `/settings/session/${sessionId}`);
}

function SessionRowActions({
  session,
  schoolId,
  onActivate,
  onDelete,
}: {
  session: SchoolSessionDto;
  schoolId: string;
  onActivate: (session: SchoolSessionDto) => void;
  onDelete: (session: SchoolSessionDto) => void;
}) {
  const resource = { kind: 'school' as const, schoolId };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for session ${session.sessionStartYear}–${session.sessionEndYear}`}
        >
          <MoreVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href={sessionDetailHref(schoolId, session.id)}>
              <ExternalLink aria-hidden />
              View session
            </Link>
          </DropdownMenuItem>
          {!session.isActive ? (
            <RequirePermissions
              permissions={{
                action: SCHOOL_ACTIONS.ACTIVATE_SESSION,
                resource,
              }}
            >
              <DropdownMenuItem onClick={() => onActivate(session)}>
                <CheckCircle2 aria-hidden className="text-emerald-600" />
                Set as active
              </DropdownMenuItem>
            </RequirePermissions>
          ) : null}
          {!session.isActive ? (
            <RequirePermissions
              permissions={{ action: SCHOOL_ACTIONS.DELETE_SESSION, resource }}
            >
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(session)}
              >
                <Trash2 aria-hidden />
                Delete session
              </DropdownMenuItem>
            </RequirePermissions>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function createSessionColumns(
  schoolId: string,
  onActivate: (session: SchoolSessionDto) => void,
  onDelete: (session: SchoolSessionDto) => void,
): DataTableColumnDef<SchoolSessionDto>[] {
  return [
    {
      accessorKey: 'sessionStartYear',
      header: 'Session',
      cell: ({ row }) => (
        <Link
          href={sessionDetailHref(schoolId, row.original.id)}
          className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          {row.original.sessionStartYear}&ndash;{row.original.sessionEndYear}
        </Link>
      ),
    },
    {
      id: 'active',
      header: 'Active',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.isActive ? (
          <Badge
            variant="outline"
            className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
          >
            Active
          </Badge>
        ) : null,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <SessionRowActions
          session={row.original}
          schoolId={schoolId}
          onActivate={onActivate}
          onDelete={onDelete}
        />
      ),
    },
  ];
}

function SessionRows({
  schoolId,
  controller,
}: {
  schoolId: string;
  controller: SessionListController;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sessionToDelete, setSessionToDelete] = useState<SchoolSessionDto>();
  const { data } = useSuspenseQuery(
    orpc.school.listSessions.queryOptions({
      input: {
        schoolId,
        page: controller.query.page,
        limit: controller.query.limit,
        orderBy: controller.query.orderBy,
        filters: {
          startYears: controller.query.filters?.startYears?.length
            ? controller.query.filters.startYears
            : undefined,
          endYears: controller.query.filters?.endYears?.length
            ? controller.query.filters.endYears
            : undefined,
        },
      },
    }),
  );

  const activateSessionMutation = useMutation({
    mutationFn: (session: SchoolSessionDto) =>
      client.school.activateSession({ schoolId, sessionId: session.id }),
    onSuccess: async (_data, session) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.school.getSession.queryKey({
          input: { schoolId, sessionId: session.id },
        }),
      });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (session: SchoolSessionDto) =>
      client.school.deleteSession({ schoolId, sessionId: session.id }),
    onSuccess: async () => {
      setSessionToDelete(undefined);
      if (
        data.items.length === 1 &&
        controller.tableState.pagination.pageIndex > 0
      ) {
        controller.onPaginationChange((current) => ({
          ...current,
          pageIndex: current.pageIndex - 1,
        }));
      }
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
    },
  });

  const columns = useMemo(
    () =>
      createSessionColumns(
        schoolId,
        (session) => activateSessionMutation.mutate(session),
        setSessionToDelete,
      ),
    [schoolId, activateSessionMutation],
  );
  const hasActiveFilters =
    Boolean(controller.query.filters?.startYears?.length) ||
    Boolean(controller.query.filters?.endYears?.length);

  return (
    <>
      <DataTable
        ariaLabel="Academic sessions"
        columns={columns}
        data={data.items}
        getRowId={(session) => session.id}
        manualPagination
        manualSorting
        onPaginationChange={controller.onPaginationChange}
        onSortingChange={controller.onSortingChange}
        onRowClick={(session) => {
          router.push(sessionDetailHref(schoolId, session.id));
        }}
        pageCount={data.pagination.totalPages}
        rowCount={data.pagination.totalItems}
        showPagination
        state={controller.tableState}
        emptyMessage={
          hasActiveFilters
            ? 'No sessions match the selected filters.'
            : 'No academic sessions have been added yet.'
        }
      />

      <AlertDialog
        open={sessionToDelete !== undefined}
        onOpenChange={(open) => {
          if (!open && !deleteSessionMutation.isPending) {
            setSessionToDelete(undefined);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete session {sessionToDelete?.sessionStartYear}&ndash;
              {sessionToDelete?.sessionEndYear}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this academic session and its
              configuration. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSessionMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteSessionMutation.isPending}
              onClick={() => {
                if (sessionToDelete) {
                  deleteSessionMutation.mutate(sessionToDelete);
                }
              }}
            >
              {deleteSessionMutation.isPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SessionsTable({ schoolId }: { schoolId: string }) {
  const resource = { kind: 'school' as const, schoolId };
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const controller = useDataTableListState<SessionOrderField, SessionFilters>({
    defaultOrderBy: { field: 'sessionStartYear', direction: 'desc' },
    defaultFilters: {},
  });
  const filterOptionsQuery = useQuery(
    orpc.school.listSessionFilterOptions.queryOptions({ input: { schoolId } }),
  );
  const filterConfigs = useMemo<
    TableFilterConfig<'startYears' | 'endYears', number>[]
  >(() => {
    const currentYear = new Date().getFullYear();
    const startYears = filterOptionsQuery.data?.startYears.length
      ? filterOptionsQuery.data.startYears
      : [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];
    const endYears = filterOptionsQuery.data?.endYears.length
      ? filterOptionsQuery.data.endYears
      : [currentYear + 2, currentYear + 1, currentYear, currentYear - 1];

    return [
      {
        id: 'startYears',
        label: 'Start year',
        type: 'multiple',
        options: startYears.map((year) => ({ label: String(year), value: year })),
      },
      {
        id: 'endYears',
        label: 'End year',
        type: 'multiple',
        options: endYears.map((year) => ({ label: String(year), value: year })),
      },
    ];
  }, [filterOptionsQuery.data]);
  const createSessionMutation = useMutation({
    mutationFn: (value: {
      sessionStartYear: number;
      sessionEndYear: number;
    }) => client.school.createSession({ schoolId, ...value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessionFilterOptions.queryKey({
          input: { schoolId },
        }),
      });
    },
  });
  const suspenseKey = JSON.stringify(controller.query);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Academic Sessions
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse and manage the academic sessions for this school.
          </p>
        </div>
        <RequirePermissions
          permissions={{ action: SCHOOL_ACTIONS.CREATE_SESSION, resource }}
        >
          <Button
            type="button"
            size="sm"
            className="w-fit"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="size-3.5" />
            New session
          </Button>
        </RequirePermissions>
      </div>

      <TableFilterBar
        filters={filterConfigs}
        values={controller.query.filters ?? {}}
        onValuesChange={controller.onFiltersChange}
      />

      <DataTableSuspense key={suspenseKey} columnCount={3}>
        <SessionRows schoolId={schoolId} controller={controller} />
      </DataTableSuspense>

      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.CREATE_SESSION, resource }}
      >
        <CreateSessionDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          onSubmit={async (value) => {
            await createSessionMutation.mutateAsync(value);
          }}
          isSubmitting={createSessionMutation.isPending}
        />
      </RequirePermissions>
    </section>
  );
}
