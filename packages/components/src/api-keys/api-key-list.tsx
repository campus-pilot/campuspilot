'use client';

import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { KeyRound, LoaderCircle, Trash2 } from 'lucide-react';

/** The fields of a stored key the account UIs display; never the secret. */
export type ApiKeySummary = {
  id: string;
  name: string | null;
  /** First characters of the key, for recognising it. */
  start: string | null;
  createdAt: Date | string;
  lastRequest: Date | string | null;
  expiresAt: Date | string | null;
};

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString();
}

function isExpired(apiKey: ApiKeySummary, now: number) {
  return (
    apiKey.expiresAt !== null && new Date(apiKey.expiresAt).getTime() <= now
  );
}

function keyDetails(apiKey: ApiKeySummary, now: number) {
  const used = apiKey.lastRequest
    ? `Last used ${formatDate(apiKey.lastRequest)}`
    : 'Never used';
  const expiry = apiKey.expiresAt
    ? `${isExpired(apiKey, now) ? 'Expired' : 'Expires'} ${formatDate(apiKey.expiresAt)}`
    : 'No expiry';
  return `Created ${formatDate(apiKey.createdAt)} · ${used} · ${expiry}`;
}

function ApiKeyRow({
  apiKey,
  now,
  onRequestDelete,
}: {
  apiKey: ApiKeySummary;
  now: number;
  onRequestDelete: (apiKey: ApiKeySummary) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
        <KeyRound className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">
            {apiKey.name || 'Unnamed key'}
          </p>
          <Badge variant="outline">{apiKey.start || 'Key'}…</Badge>
          {isExpired(apiKey, now) ? (
            <Badge variant="secondary">Expired</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {keyDetails(apiKey, now)}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete API key ${apiKey.name ?? ''}`.trim()}
        onClick={() => onRequestDelete(apiKey)}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

/**
 * The user's keys with loading, failure and empty states. Data and the delete
 * request come from the caller; this component makes no API calls.
 */
export function ApiKeyList({
  status,
  apiKeys,
  errorMessage,
  onRetry,
  onRequestDelete,
}: {
  status: 'pending' | 'error' | 'success';
  apiKeys: readonly ApiKeySummary[];
  errorMessage?: string;
  onRetry: () => void;
  onRequestDelete: (apiKey: ApiKeySummary) => void;
}) {
  if (status === 'pending') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Loading keys…
      </p>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-destructive">
          {errorMessage ?? 'Unable to load your API keys.'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (apiKeys.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
        You have not created any API keys.
      </p>
    );
  }

  const now = Date.now();
  return (
    <ul className="flex flex-col gap-2">
      {apiKeys.map((apiKey) => (
        <ApiKeyRow
          key={apiKey.id}
          apiKey={apiKey}
          now={now}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </ul>
  );
}
