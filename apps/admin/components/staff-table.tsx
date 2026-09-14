'use client';

import { useState } from 'react';
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import type { SchoolMemberDto } from '@campuspilot/api/routers/school/member/member.dto';
import {
  DataTable,
  DataTableSuspense,
  TableSearchBar,
  useDataTableListState,
  type DataTableColumnDef,
  type DataTableListController,
} from '@campuspilot/components/data-grid';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@campuspilot/ui/components/avatar';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { MoreVertical, UserMinus } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';

type StaffOrderField = 'name' | 'email' | 'addedAt';
type StaffListController = DataTableListController<StaffOrderField, never>;

const roleLabels = {
  principal: 'Principal',
  teacher: 'Teacher',
  accountant: 'Accountant',
  exam_coordinator: 'Exam coordinator',
  manager: 'Manager',
} as const;

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

/** Invited users intentionally have no display name until account setup. */
function memberLabel(member: SchoolMemberDto) {
  return member.name.trim() || 'Pending setup';
}

function memberIdentity(member: SchoolMemberDto) {
  return member.name.trim() || member.email;
}

function memberInitials(member: SchoolMemberDto) {
  return memberIdentity(member)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function StaffRowActions({
  member,
  onRemove,
}: {
  member: SchoolMemberDto;
  onRemove: (member: SchoolMemberDto) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${memberIdentity(member)}`}
        >
          <MoreVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onRemove(member)}
          >
            <UserMinus aria-hidden />
            Remove from staff
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function createStaffColumns(
  onRemove: (member: SchoolMemberDto) => void,
): DataTableColumnDef<SchoolMemberDto>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex min-w-52 items-center gap-2.5">
          <Avatar>
            {row.original.image ? (
              <AvatarImage src={row.original.image} alt="" />
            ) : null}
            <AvatarFallback>{memberInitials(row.original)}</AvatarFallback>
          </Avatar>
          <span
            className={
              row.original.name.trim()
                ? 'font-medium'
                : 'text-muted-foreground'
            }
          >
            {memberLabel(row.original)}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: 'Email',
    },
    {
      id: 'roles',
      header: 'Roles',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex min-w-56 flex-wrap gap-1">
          {row.original.roles.map(({ role }) => (
            <Badge key={role} variant="secondary">
              {roleLabels[role]}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      accessorKey: 'addedAt',
      header: 'Added',
      cell: ({ row }) => dateFormatter.format(row.original.addedAt),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <StaffRowActions member={row.original} onRemove={onRemove} />
      ),
    },
  ];
}

function StaffRows({
  schoolId,
  controller,
}: {
  schoolId: string;
  controller: StaffListController;
}) {
  const [memberToRemove, setMemberToRemove] = useState<SchoolMemberDto>();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(
    orpc.school.listMembers.queryOptions({
      input: {
        schoolId,
        page: controller.query.page,
        limit: controller.query.limit,
        searchQuery: controller.query.searchQuery,
        orderBy: controller.query.orderBy,
      },
    }),
  );
  const removeMemberMutation = useMutation({
    mutationFn: (member: SchoolMemberDto) =>
      client.school.removeMember({ schoolId, userId: member.userId }),
    onSuccess: async () => {
      setMemberToRemove(undefined);
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
        queryKey: orpc.school.listMembers.queryKey({ input: { schoolId } }),
      });
    },
  });
  const staffColumns = createStaffColumns(setMemberToRemove);

  function handleRemoveDialogOpenChange(open: boolean) {
    if (open || removeMemberMutation.isPending) return;
    setMemberToRemove(undefined);
    removeMemberMutation.reset();
  }

  return (
    <>
      <DataTable
        ariaLabel="School staff"
        columns={staffColumns}
        data={data.items}
        getRowId={(member) => member.userId}
        manualPagination
        manualSorting
        onPaginationChange={controller.onPaginationChange}
        onSortingChange={controller.onSortingChange}
        pageCount={data.pagination.totalPages}
        rowCount={data.pagination.totalItems}
        showPagination
        state={controller.tableState}
        emptyMessage={
          controller.query.searchQuery
            ? 'No staff members match this search.'
            : 'No staff members have been invited yet.'
        }
      />
      <AlertDialog
        open={memberToRemove !== undefined}
        onOpenChange={handleRemoveDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              {memberToRemove
                ? `${memberIdentity(memberToRemove)} will lose access to this school. Their CampusPilot account will not be deleted.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeMemberMutation.error ? (
            <p className="text-xs text-destructive">
              {removeMemberMutation.error instanceof Error
                ? removeMemberMutation.error.message
                : 'Unable to remove this staff member.'}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMemberMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={!memberToRemove || removeMemberMutation.isPending}
              onClick={() => {
                if (memberToRemove) removeMemberMutation.mutate(memberToRemove);
              }}
            >
              {removeMemberMutation.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function StaffTable({ schoolId }: { schoolId: string }) {
  const controller = useDataTableListState<StaffOrderField>({
    defaultOrderBy: { field: 'name', direction: 'asc' },
  });
  const suspenseKey = JSON.stringify(controller.query);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
        <p className="text-sm text-muted-foreground">
          View the people and role assignments for this school.
        </p>
      </div>
      <TableSearchBar
        placeholder="Search staff…"
        onSearchChange={controller.onSearchChange}
      />
      <DataTableSuspense key={suspenseKey} columnCount={5}>
        <StaffRows schoolId={schoolId} controller={controller} />
      </DataTableSuspense>
    </section>
  );
}
