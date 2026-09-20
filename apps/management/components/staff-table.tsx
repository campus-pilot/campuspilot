'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import {
  roleEnum,
  type Role,
  type SchoolMemberDto,
} from '@campuspilot/api/routers/school/member/member.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { Label } from '@campuspilot/ui/components/label';
import { MoreVertical, Pencil, UserMinus } from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from './require-permissions';
import { roleLabels, StaffRolePicker } from './staff-role-picker';

type StaffOrderField = 'name' | 'email' | 'addedAt';
type StaffListController = DataTableListController<StaffOrderField, never>;

const rolesFormSchema = z.object({
  roles: z.array(roleEnum).min(1, 'Select at least one role.'),
});

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

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

function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : undefined;
    return message ? (
      <p key={`${message}-${index}`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

function EditRolesDialog({
  member,
  schoolId,
  onClose,
}: {
  member: SchoolMemberDto;
  schoolId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { roles: member.roles.map(({ role }) => role) as Role[] },
    validators: { onSubmit: rolesFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        await client.school.updateMemberRoles({
          schoolId,
          userId: member.userId,
          roles: value.roles.map((role) => ({
            role,
            // Preserve role metadata when an existing assignment survives the edit.
            meta:
              member.roles.find((assignment) => assignment.role === role)
                ?.meta ?? (role === 'teacher' ? { classIds: null } : null),
          })),
        });
        await queryClient.invalidateQueries({
          queryKey: orpc.school.listMembers.queryKey({ input: { schoolId } }),
        });
        onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to update this staff member.',
            fields: {},
          },
        });
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit staff roles</DialogTitle>
          <DialogDescription>
            Update the roles assigned to {memberIdentity(member)}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="roles">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-roles">Roles</Label>
                <StaffRolePicker
                  id="staff-roles"
                  roles={field.state.value}
                  invalid={field.state.meta.errors.length > 0}
                  onChange={field.handleChange}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isDirty: state.isDirty,
              isSubmitting: state.isSubmitting,
              errors: state.errors,
            })}
          >
            {({ canSubmit, isDirty, isSubmitting, errors }) => (
              <>
                <FieldErrors errors={errors} />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={onClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!canSubmit || !isDirty || isSubmitting}
                  >
                    {isSubmitting ? 'Saving…' : 'Save roles'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StaffRowActions({
  member,
  schoolId,
  onEdit,
  onRemove,
}: {
  member: SchoolMemberDto;
  schoolId: string;
  onEdit: (member: SchoolMemberDto) => void;
  onRemove: (member: SchoolMemberDto) => void;
}) {
  return (
    <RequirePermissions
      permissions={[
        {
          action: SCHOOL_ACTIONS.UPDATE_MEMBER_ROLES,
          resource: { kind: 'school', schoolId },
        },
        {
          action: SCHOOL_ACTIONS.REMOVE_MEMBER,
          resource: { kind: 'school', schoolId },
        },
      ]}
    >
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
            <DropdownMenuItem onClick={() => onEdit(member)}>
              <Pencil aria-hidden />
              Edit roles
            </DropdownMenuItem>
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
    </RequirePermissions>
  );
}

function createStaffColumns(options: {
  schoolId: string;
  onEdit: (member: SchoolMemberDto) => void;
  onRemove: (member: SchoolMemberDto) => void;
}): DataTableColumnDef<SchoolMemberDto>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex min-w-52 items-center gap-2.5">
          <Avatar>
            {row.original.profileImageUrl ? (
              <AvatarImage src={row.original.profileImageUrl} alt="" />
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
    { accessorKey: 'email', header: 'Email' },
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
        <StaffRowActions
          member={row.original}
          schoolId={options.schoolId}
          onEdit={options.onEdit}
          onRemove={options.onRemove}
        />
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
  const [memberToEdit, setMemberToEdit] = useState<SchoolMemberDto>();
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
  const columns = createStaffColumns({
    schoolId,
    onEdit: setMemberToEdit,
    onRemove: setMemberToRemove,
  });

  function handleRemoveDialogOpenChange(open: boolean) {
    if (open || removeMemberMutation.isPending) return;
    setMemberToRemove(undefined);
    removeMemberMutation.reset();
  }

  return (
    <>
      <DataTable
        ariaLabel="School staff"
        columns={columns}
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
      {memberToEdit ? (
        <EditRolesDialog
          key={memberToEdit.userId}
          member={memberToEdit}
          schoolId={schoolId}
          onClose={() => setMemberToEdit(undefined)}
        />
      ) : null}
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
