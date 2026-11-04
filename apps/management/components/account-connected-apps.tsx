'use client';

import {
  type ConnectedApp,
  ConnectedAppsPanel,
} from '@campuspilot/components/connected-apps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { client, orpc } from '@/lib/orpc';

/**
 * Loads the user's OAuth connections page by page and disconnects one on
 * confirmation; the list is refetched from the server afterwards.
 */
function useConnectedApps() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedApp | null>(null);
  const list = useQuery(
    orpc.auth.listOAuthConnections.queryOptions({ input: { page } }),
  );
  const disconnect = useMutation({
    mutationFn: (clientId: string) => client.auth.disconnectOAuthConnection({ clientId }),
    onSuccess: () => setDisconnectTarget(null),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orpc.auth.listOAuthConnections.key() }),
  });
  return { page, setPage, list, disconnect, disconnectTarget, setDisconnectTarget };
}

/** Account-dialog section listing the AI apps connected to the user's account. */
export function AccountConnectedApps() {
  const { page, setPage, list, disconnect, disconnectTarget, setDisconnectTarget } =
    useConnectedApps();

  return (
    <ConnectedAppsPanel
      status={list.status}
      apps={list.data?.items ?? []}
      errorMessage={list.error?.message}
      onRetry={() => void list.refetch()}
      page={page}
      totalPages={list.data?.pagination.totalPages ?? 1}
      onPageChange={setPage}
      disconnectTarget={disconnectTarget}
      onRequestDisconnect={(app) => {
        disconnect.reset();
        setDisconnectTarget(app);
      }}
      onCancelDisconnect={() => setDisconnectTarget(null)}
      onConfirmDisconnect={() => {
        if (disconnectTarget) disconnect.mutate(disconnectTarget.clientId);
      }}
      disconnectPending={disconnect.isPending}
      disconnectErrorMessage={disconnect.error?.message}
    />
  );
}
