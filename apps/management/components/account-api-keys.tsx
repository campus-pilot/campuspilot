'use client';

import { apiKeyExpiresInSeconds } from '@campuspilot/auth/api-key-policy';
import {
  type ApiKeyCreateValues,
  ApiKeysPanel,
  type ApiKeySummary,
} from '@campuspilot/components/api-keys';
import { env } from '@campuspilot/env/management.client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';

const apiKeysQueryKey = ['auth', 'api-keys'] as const;

/** Better Auth client calls resolve to { data, error }; surface errors as throws. */
function unwrap<T>(result: {
  data: T | null;
  error: { message?: string } | null;
}): T {
  if (result.error || result.data === null) {
    throw new Error(result.error?.message ?? 'The request failed.');
  }
  return result.data;
}

/**
 * Loads and mutates the signed-in user's API keys. Creating or deleting a key
 * invalidates the list instead of patching it locally, so the list always
 * reflects what the server stored.
 */
function useAccountApiKeys() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<ApiKeySummary | null>(null);
  const list = useQuery({
    queryKey: apiKeysQueryKey,
    queryFn: async () => unwrap(await authClient.apiKey.list()).apiKeys,
  });
  const create = useMutation({
    mutationFn: async ({ name, expiresInDays }: ApiKeyCreateValues) =>
      unwrap(
        await authClient.apiKey.create({
          name,
          expiresIn: apiKeyExpiresInSeconds(expiresInDays),
        }),
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: apiKeysQueryKey }),
  });
  const remove = useMutation({
    mutationFn: async (keyId: string) =>
      unwrap(await authClient.apiKey.delete({ keyId })),
    onSuccess: () => setDeleteTarget(null),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: apiKeysQueryKey }),
  });
  return { list, create, remove, deleteTarget, setDeleteTarget };
}

/** Account-dialog section where users manage their own API keys. */
export function AccountApiKeys() {
  const { list, create, remove, deleteTarget, setDeleteTarget } =
    useAccountApiKeys();

  return (
    <ApiKeysPanel
      mcpUrl={env.NEXT_PUBLIC_MCP_URL}
      listStatus={list.status}
      apiKeys={list.data ?? []}
      listErrorMessage={list.error?.message}
      onRetryList={() => void list.refetch()}
      onCreate={async (values) => {
        await create.mutateAsync(values);
      }}
      createdKey={create.data?.key}
      onDismissCreatedKey={create.reset}
      deleteTarget={deleteTarget}
      onRequestDelete={(apiKey) => {
        remove.reset();
        setDeleteTarget(apiKey);
      }}
      onCancelDelete={() => setDeleteTarget(null)}
      onConfirmDelete={() => {
        if (deleteTarget) remove.mutate(deleteTarget.id);
      }}
      deletePending={remove.isPending}
      deleteErrorMessage={remove.error?.message}
    />
  );
}
