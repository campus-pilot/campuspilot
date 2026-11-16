'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { PlatformUserDto } from '@campuspilot/api/routers/system-admin/user/user.dto';
import {
  DataTable,
  DataTableSuspense,
  TableSearchBar,
  useDataTableListState,
  type DataTableColumnDef,
  type DataTableListController,
} from '@campuspilot/components/data-grid';
import {
  formatStaffPhoneNumber,
  staffSignInLabel,
} from '@campuspilot/components/staff-account/staff-sign-in-label';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { AtSign, KeyRound, MoreVertical } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { orpc } from '@/lib/orpc';
import { EditUserSignInDialog } from './edit-user-sign-in-dialog';
import { SetUserPasswordDialog } from './set-user-password-dialog';

type UserOrderField = 'name' | 'createdAt';
type UserListController = DataTableListController<UserOrderField, never>;
type UserDialog = { kind: 'password' | 'sign-in'; user: PlatformUserDto };

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

function SignInMethods({ user }: { user: PlatformUserDto }) {
  if (!user.hasPassword && !user.hasGoogle) {
    return <span className="text-muted-foreground">None yet</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {user.hasPassword ? <Badge variant="secondary">Password</Badge> : null}
      {user.hasGoogle ? <Badge variant="secondary">Google</Badge> : null}
    </div>
  );
}

function UserSchools({ user }: { user: PlatformUserDto }) {
  if (user.schools.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex min-w-40 flex-wrap gap-1">
      {user.schools.map((school) => (
        <Badge key={school.schoolId} variant="outline" asChild>
          <Link href={`/school/${school.schoolId}`}>{school.name}</Link>
        </Badge>
      ))}
    </div>
  );
}

function UserRowActions({
  user,
  isSelf,
  onOpen,
}: {
  user: PlatformUserDto;
  /** Your own password is changed in account settings, not here. */
  isSelf: boolean;
  onOpen: (dialog: UserDialog) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${user.name.trim() || staffSignInLabel(user)}`}
        >
          <MoreVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {isSelf ? null : (
            <DropdownMenuItem onClick={() => onOpen({ kind: 'password', user })}>
              <KeyRound aria-hidden />
              {user.hasPassword ? 'Reset password' : 'Set password'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onOpen({ kind: 'sign-in', user })}>
            <AtSign aria-hidden />
            Edit email and phone
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function createUserColumns(options: {
  currentUserId: string | undefined;
  onOpen: (dialog: UserDialog) => void;
}): DataTableColumnDef<PlatformUserDto>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) =>
        row.original.name.trim() ? (
          <span className="font-medium">{row.original.name}</span>
        ) : (
          <span className="text-muted-foreground">Pending setup</span>
        ),
    },
    {
      id: 'email',
      header: 'Email',
      enableSorting: false,
      cell: ({ row }) => row.original.email ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'phoneNumber',
      header: 'Phone',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.phoneNumber ? (
          <span className="whitespace-nowrap">{formatStaffPhoneNumber(row.original.phoneNumber)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'signIn',
      header: 'Sign-in',
      enableSorting: false,
      cell: ({ row }) => <SignInMethods user={row.original} />,
    },
    {
      id: 'schools',
      header: 'Schools',
      enableSorting: false,
      cell: ({ row }) => <UserSchools user={row.original} />,
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => dateFormatter.format(row.original.createdAt),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <UserRowActions
          user={row.original}
          isSelf={row.original.userId === options.currentUserId}
          onOpen={options.onOpen}
        />
      ),
    },
  ];
}

function UserRows({ controller }: { controller: UserListController }) {
  const [dialog, setDialog] = useState<UserDialog>();
  const { data: session } = authClient.useSession();
  const { data } = useSuspenseQuery(
    orpc.systemAdmin.listUsers.queryOptions({
      input: {
        page: controller.query.page,
        limit: controller.query.limit,
        searchQuery: controller.query.searchQuery,
        orderBy: controller.query.orderBy,
      },
    }),
  );
  const columns = createUserColumns({ currentUserId: session?.user.id, onOpen: setDialog });

  return (
    <>
      <DataTable
        ariaLabel="Users"
        columns={columns}
        data={data.items}
        getRowId={(user) => user.userId}
        manualPagination
        manualSorting
        onPaginationChange={controller.onPaginationChange}
        onSortingChange={controller.onSortingChange}
        pageCount={data.pagination.totalPages}
        rowCount={data.pagination.totalItems}
        showPagination
        state={controller.tableState}
        emptyMessage={
          controller.query.searchQuery ? 'No users match this search.' : 'No users yet.'
        }
      />
      {dialog?.kind === 'password' ? (
        <SetUserPasswordDialog
          key={dialog.user.userId}
          user={dialog.user}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'sign-in' ? (
        <EditUserSignInDialog
          key={dialog.user.userId}
          user={dialog.user}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
    </>
  );
}

/**
 * Every CampusPilot account, searchable by name, email or phone number, with
 * actions to set a password and change sign-in details. Staff are added to
 * schools from each school's Staff page.
 */
export function UsersTable() {
  const controller = useDataTableListState<UserOrderField>({
    defaultOrderBy: { field: 'name', direction: 'asc' },
  });
  const suspenseKey = JSON.stringify(controller.query);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Find anyone by name, email or phone number, reset their password, or add an email.
        </p>
      </div>
      <TableSearchBar
        placeholder="Search by name, email or phone…"
        onSearchChange={controller.onSearchChange}
      />
      <DataTableSuspense key={suspenseKey} columnCount={7}>
        <UserRows controller={controller} />
      </DataTableSuspense>
    </section>
  );
}
