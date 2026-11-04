'use client';

import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { BadgeCheck, Bot, LoaderCircle } from 'lucide-react';

import { ConfirmationDialog } from '../confirmation-dialog';

/** One AI app the user connected through OAuth (display facts only). */
export type ConnectedApp = {
  clientId: string;
  name: string | null;
  registrationMethod:
    | 'client_id_metadata_document'
    | 'pre_registered'
    | 'dynamic'
    | 'unknown';
  verifiedHost: string | null;
  scopes: readonly string[];
  connectedAt: Date | string | null;
  lastUsedAt: Date | string | null;
};

function formatDate(value: Date | string | null) {
  return value ? new Date(value).toLocaleDateString() : null;
}

function appName(app: ConnectedApp) {
  return app.name?.trim() || 'Unnamed app';
}

function identityLabel(app: ConnectedApp) {
  if (app.verifiedHost) return `Verified as ${app.verifiedHost}`;
  if (app.registrationMethod === 'pre_registered') return 'Registered by CampusPilot';
  return 'Not verified';
}

function ConnectedAppRow({
  app,
  onDisconnect,
}: {
  app: ConnectedApp;
  onDisconnect: (app: ConnectedApp) => void;
}) {
  const canWrite = app.scopes.includes('mcp:write');
  const connected = formatDate(app.connectedAt);
  const used = formatDate(app.lastUsedAt);
  return (
    <li className="flex items-center gap-3 rounded-xl border p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{appName(app)}</p>
          <Badge variant="outline">{canWrite ? 'Read and change' : 'Read only'}</Badge>
        </div>
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          {app.verifiedHost ? <BadgeCheck className="size-3" aria-hidden="true" /> : null}
          {identityLabel(app)}
          {connected ? ` · Connected ${connected}` : null}
          {` · ${used ? `Last used ${used}` : 'Not used yet'}`}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onDisconnect(app)}
      >
        Disconnect
      </Button>
    </li>
  );
}

function ConnectedAppsList({
  status,
  apps,
  errorMessage,
  onRetry,
  onDisconnect,
}: {
  status: 'pending' | 'error' | 'success';
  apps: readonly ConnectedApp[];
  errorMessage?: string;
  onRetry: () => void;
  onDisconnect: (app: ConnectedApp) => void;
}) {
  if (status === 'pending') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Loading connected apps…
      </p>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-destructive">
          {errorMessage ?? 'Unable to load your connected apps.'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (apps.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
        No AI apps are connected. Add CampusPilot as a connector in Claude, ChatGPT or Gemini to
        connect one.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {apps.map((app) => (
        <ConnectedAppRow key={app.clientId} app={app} onDisconnect={onDisconnect} />
      ))}
    </ul>
  );
}

function PageControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      Page {page} of {totalPages}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

export type ConnectedAppsPanelProps = {
  status: 'pending' | 'error' | 'success';
  apps: readonly ConnectedApp[];
  errorMessage?: string;
  onRetry: () => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** The app awaiting disconnect confirmation, if any. */
  disconnectTarget: ConnectedApp | null;
  onRequestDisconnect: (app: ConnectedApp) => void;
  onCancelDisconnect: () => void;
  onConfirmDisconnect: () => void;
  disconnectPending: boolean;
  disconnectErrorMessage?: string;
};

/**
 * Account section listing the AI apps a user connected through OAuth, with
 * disconnect behind the app confirmation dialog. Data and requests come from
 * the caller.
 */
export function ConnectedAppsPanel(props: ConnectedAppsPanelProps) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Connected apps</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          AI apps such as Claude, ChatGPT or Gemini that can use CampusPilot for you, with your
          permissions in every school you can access.
        </p>
      </div>
      <ConnectedAppsList
        status={props.status}
        apps={props.apps}
        errorMessage={props.errorMessage}
        onRetry={props.onRetry}
        onDisconnect={props.onRequestDisconnect}
      />
      <PageControls
        page={props.page}
        totalPages={props.totalPages}
        onPageChange={props.onPageChange}
      />
      <ConfirmationDialog
        open={props.disconnectTarget !== null}
        title="Disconnect app?"
        description={`${props.disconnectTarget ? appName(props.disconnectTarget) : 'This app'} loses access to CampusPilot immediately. You can connect it again later.`}
        confirmLabel={props.disconnectPending ? 'Disconnecting…' : 'Disconnect'}
        pending={props.disconnectPending}
        onOpenChange={(open) => {
          if (!open) props.onCancelDisconnect();
        }}
        onConfirm={props.onConfirmDisconnect}
      >
        {props.disconnectErrorMessage ? (
          <p className="text-xs text-destructive">{props.disconnectErrorMessage}</p>
        ) : null}
      </ConfirmationDialog>
    </section>
  );
}
