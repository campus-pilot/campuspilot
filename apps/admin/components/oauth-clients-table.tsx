'use client';

import { useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { oauthClientDtoSchema } from '@campuspilot/api/routers/system-admin/oauth-client/oauth-client.dto';
import { CopyValueField } from '@campuspilot/components/api-keys';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
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
import { Ban, CircleCheck, KeyRound, MoreVertical, Trash2 } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';

type OAuthClient = z.infer<typeof oauthClientDtoSchema>;
type RegistrationMethod = OAuthClient['registrationMethod'];
type OrderField = 'createdAt' | 'name';
type Filters = { registrationMethod?: RegistrationMethod; status?: 'active' | 'disabled' };
type Controller = DataTableListController<OrderField, Filters>;

/** The action an administrator is confirming for one client. */
type PendingAction =
  | { kind: 'rotate' | 'delete' | 'disable' | 'enable'; client: OAuthClient }
  | null;

const methodLabels: Record<RegistrationMethod, string> = {
  client_id_metadata_document: 'Metadata document',
  pre_registered: 'Pre-registered',
  dynamic: 'Dynamic',
  unknown: 'Unknown',
};

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

const filters: TableFilterConfig<keyof Filters>[] = [
  {
    id: 'registrationMethod',
    label: 'Registration',
    type: 'single',
    options: (Object.keys(methodLabels) as RegistrationMethod[]).map((value) => ({
      value,
      label: methodLabels[value],
    })),
  },
  {
    id: 'status',
    label: 'Status',
    type: 'single',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'disabled', label: 'Disabled' },
    ],
  },
];

function ClientActions({
  oauthClient,
  onAction,
}: {
  oauthClient: OAuthClient;
  onAction: (action: PendingAction) => void;
}) {
  const preRegistered = oauthClient.registrationMethod === 'pre_registered';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${oauthClient.name ?? oauthClient.clientId}`}
        >
          <MoreVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {preRegistered ? (
            <DropdownMenuItem onClick={() => onAction({ kind: 'rotate', client: oauthClient })}>
              <KeyRound aria-hidden />
              Rotate secret
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() =>
              onAction({
                kind: oauthClient.disabled ? 'enable' : 'disable',
                client: oauthClient,
              })
            }
          >
            {oauthClient.disabled ? <CircleCheck aria-hidden /> : <Ban aria-hidden />}
            {oauthClient.disabled ? 'Enable' : 'Disable'}
          </DropdownMenuItem>
          {preRegistered ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onAction({ kind: 'delete', client: oauthClient })}
            >
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function clientColumns(
  onAction: (action: PendingAction) => void,
): DataTableColumnDef<OAuthClient>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Client',
      cell: ({ row }) => (
        <span className="flex min-w-56 flex-col gap-0.5">
          <span className="truncate font-medium">{row.original.name ?? 'Unnamed client'}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {row.original.clientId}
          </span>
        </span>
      ),
    },
    {
      id: 'registrationMethod',
      header: 'Registration',
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="outline">{methodLabels[row.original.registrationMethod]}</Badge>
      ),
    },
    {
      id: 'verifiedHost',
      header: 'Verified host',
      enableSorting: false,
      cell: ({ row }) => row.original.verifiedHost ?? '—',
    },
    {
      id: 'connectionCount',
      header: 'Connections',
      enableSorting: false,
      cell: ({ row }) => row.original.connectionCount,
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant={row.original.disabled ? 'destructive' : 'secondary'}>
          {row.original.disabled ? 'Disabled' : 'Active'}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) =>
        row.original.createdAt ? dateFormatter.format(new Date(row.original.createdAt)) : '—',
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => <ClientActions oauthClient={row.original} onAction={onAction} />,
    },
  ];
}

function ClientRows({
  controller,
  onAction,
}: {
  controller: Controller;
  onAction: (action: PendingAction) => void;
}) {
  const status = controller.query.filters?.status;
  const { data } = useSuspenseQuery(
    orpc.systemAdmin.listOAuthClients.queryOptions({
      input: {
        page: controller.query.page,
        limit: controller.query.limit,
        searchQuery: controller.query.searchQuery,
        orderBy: controller.query.orderBy,
        filters: {
          ...(controller.query.filters?.registrationMethod
            ? { registrationMethod: controller.query.filters.registrationMethod }
            : {}),
          ...(status ? { disabled: status === 'disabled' } : {}),
        },
      },
    }),
  );
  return (
    <DataTable
      ariaLabel="OAuth clients"
      columns={clientColumns(onAction)}
      data={data.items}
      getRowId={(row) => row.clientId}
      manualPagination
      manualSorting
      onPaginationChange={controller.onPaginationChange}
      onSortingChange={controller.onSortingChange}
      pageCount={data.pagination.totalPages}
      rowCount={data.pagination.totalItems}
      showPagination
      state={controller.tableState}
      emptyMessage="No OAuth clients match."
    />
  );
}

const confirmations = {
  rotate: {
    title: 'Rotate client secret?',
    description: 'The current secret stops working immediately. Update the app with the new secret.',
    confirmLabel: 'Rotate secret',
  },
  delete: {
    title: 'Delete OAuth client?',
    description: 'Everyone connected through this client is disconnected. This cannot be undone.',
    confirmLabel: 'Delete client',
  },
  disable: {
    title: 'Disable OAuth client?',
    description: 'The app can no longer connect, and existing connections stop on their next request.',
    confirmLabel: 'Disable client',
  },
  enable: {
    title: 'Enable OAuth client?',
    description: 'Users can connect this app again. Disconnected users must reconnect.',
    confirmLabel: 'Enable client',
  },
} as const;

/** Runs a confirmed client action and refreshes the table. */
function useClientAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: NonNullable<PendingAction>) => {
      const clientId = action.client.clientId;
      switch (action.kind) {
        case 'rotate':
          return client.systemAdmin.rotateOAuthClientSecret({ clientId });
        case 'delete':
          await client.systemAdmin.deleteOAuthClient({ clientId });
          return null;
        case 'disable':
        case 'enable':
          await client.systemAdmin.setOAuthClientDisabled({
            clientId,
            disabled: action.kind === 'disable',
          });
          return null;
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listOAuthClients.key() }),
  });
}

/** Shows a client secret once, after it was created or rotated. */
export function ClientSecretDialog({
  credentials,
  onClose,
}: {
  credentials: { clientId: string; clientSecret: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={credentials !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy the client credentials</DialogTitle>
          <DialogDescription>
            The secret is shown only once. Enter both values in the AI app.
          </DialogDescription>
        </DialogHeader>
        {credentials ? (
          <div className="flex flex-col gap-3">
            <CopyValueField id="oauth-client-id" value={credentials.clientId} label="Copy client ID" />
            <CopyValueField
              id="oauth-client-secret"
              value={credentials.clientSecret}
              label="Copy client secret"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Platform list of OAuth clients with their administration actions. */
export function OAuthClientsTable() {
  const controller = useDataTableListState<OrderField, Filters>({
    defaultOrderBy: { field: 'createdAt', direction: 'desc' },
  });
  const [pending, setPending] = useState<PendingAction>(null);
  const action = useClientAction();
  const confirmation = pending ? confirmations[pending.kind] : null;

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">OAuth clients</h1>
        <p className="text-sm text-muted-foreground">
          AI apps that connect to CampusPilot. Pre-register clients for apps that need a client ID
          and secret; disable any client that misbehaves.
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TableSearchBar placeholder="Search name or client ID…" onSearchChange={controller.onSearchChange} />
        <TableFilterBar
          filters={filters}
          values={controller.query.filters ?? {}}
          onValuesChange={controller.onFiltersChange}
        />
      </div>
      <DataTableSuspense key={JSON.stringify(controller.query)} columnCount={7}>
        <ClientRows
          controller={controller}
          onAction={(next) => {
            action.reset();
            setPending(next);
          }}
        />
      </DataTableSuspense>
      <ConfirmationDialog
        open={pending !== null}
        title={confirmation?.title ?? ''}
        description={confirmation?.description ?? ''}
        confirmLabel={confirmation?.confirmLabel ?? ''}
        confirmVariant={pending?.kind === 'enable' ? 'default' : 'destructive'}
        pending={action.isPending}
        onOpenChange={(open) => (open ? null : setPending(null))}
        onConfirm={() => {
          if (!pending) return;
          action.mutate(pending, { onSuccess: () => setPending(null) });
        }}
      >
        {action.error ? <p className="text-xs text-destructive">{action.error.message}</p> : null}
      </ConfirmationDialog>
      <ClientSecretDialog
        credentials={action.data ?? null}
        onClose={() => action.reset()}
      />
    </section>
  );
}
