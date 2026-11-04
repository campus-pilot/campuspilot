'use client';

import {
  API_KEY_MAX_ACTIVE_PER_USER,
  API_KEY_MAX_EXPIRY_DAYS,
} from '@campuspilot/auth/api-key-policy';
import { Separator } from '@campuspilot/ui/components/separator';

import { ConfirmationDialog } from '../confirmation-dialog';
import { ApiKeyCreateForm, type ApiKeyCreateValues } from './api-key-create-form';
import { ApiKeyList, type ApiKeySummary } from './api-key-list';
import { ApiKeyUsage, CreatedApiKey } from './api-key-usage';

export type ApiKeysPanelProps = {
  /** Public MCP endpoint shown in the usage instructions. */
  mcpUrl: string;
  listStatus: 'pending' | 'error' | 'success';
  apiKeys: readonly ApiKeySummary[];
  listErrorMessage?: string;
  onRetryList: () => void;
  onCreate: (values: ApiKeyCreateValues) => Promise<void>;
  /** The secret of the key just created; shown once until dismissed. */
  createdKey?: string;
  onDismissCreatedKey: () => void;
  /** The key awaiting delete confirmation, if any. */
  deleteTarget: ApiKeySummary | null;
  onRequestDelete: (apiKey: ApiKeySummary) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  deletePending: boolean;
  deleteErrorMessage?: string;
};

/**
 * Account section for a user's own API keys: create, one-time reveal with
 * client instructions, list and delete. Shared by the admin and management
 * apps; each app supplies data and performs the requests.
 */
export function ApiKeysPanel(props: ApiKeysPanelProps) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">API keys</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect scripts and AI coding tools such as Claude Code, Cursor or VS
          Code to CampusPilot with your permissions. Up to{' '}
          {API_KEY_MAX_ACTIVE_PER_USER} active keys; each expires within{' '}
          {API_KEY_MAX_EXPIRY_DAYS} days.
        </p>
      </div>
      <ApiKeyCreateForm onCreate={props.onCreate} />
      {props.createdKey ? (
        <CreatedApiKey
          apiKey={props.createdKey}
          mcpUrl={props.mcpUrl}
          onDismiss={props.onDismissCreatedKey}
        />
      ) : null}
      <Separator />
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Your keys</h3>
        <ApiKeyList
          status={props.listStatus}
          apiKeys={props.apiKeys}
          errorMessage={props.listErrorMessage}
          onRetry={props.onRetryList}
          onRequestDelete={props.onRequestDelete}
        />
      </div>
      {props.createdKey ? null : (
        <details className="group rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            How to use a key
          </summary>
          <div className="mt-3">
            <ApiKeyUsage mcpUrl={props.mcpUrl} />
          </div>
        </details>
      )}
      <ConfirmationDialog
        open={props.deleteTarget !== null}
        title="Delete API key?"
        description={`Anything using “${props.deleteTarget?.name || 'this key'}” stops working immediately.`}
        confirmLabel={props.deletePending ? 'Deleting…' : 'Delete key'}
        pending={props.deletePending}
        onOpenChange={(open) => {
          if (!open) props.onCancelDelete();
        }}
        onConfirm={props.onConfirmDelete}
      >
        {props.deleteErrorMessage ? (
          <p className="text-xs text-destructive">{props.deleteErrorMessage}</p>
        ) : null}
      </ConfirmationDialog>
    </section>
  );
}
