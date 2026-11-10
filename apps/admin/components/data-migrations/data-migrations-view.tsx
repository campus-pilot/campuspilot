'use client';

import { useState } from 'react';
import type { DataMigrationRunDto } from '@campuspilot/api/routers/system-admin/data-migration/data-migration.dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';

import { orpc } from '@/lib/orpc';
import { isActiveRun } from './data-migration-run-labels';
import { DataMigrationRunsTable } from './data-migration-runs-table';
import { DataMigrationSkippedDialog } from './data-migration-skipped-dialog';

/** Poll interval while any run is queued or running. */
const ACTIVE_POLL_MS = 3_000;

type Migration = { id: string; description: string; runs: DataMigrationRunDto[] };
type PendingRequest = { migrationId: string; dryRun: boolean } | null;

/** One migration: its description, run actions and recent runs. */
function DataMigrationCard({ migration, onRequest, onShowSkipped }: {
  migration: Migration;
  onRequest: (dryRun: boolean) => void;
  onShowSkipped: (run: DataMigrationRunDto) => void;
}) {
  const busy = migration.runs.some(isActiveRun);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono text-sm">{migration.id}</CardTitle>
        <CardDescription>{migration.description}</CardDescription>
        <CardAction className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onRequest(true)}>Dry run</Button>
          <Button size="sm" disabled={busy} onClick={() => onRequest(false)}>Run</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataMigrationRunsTable runs={migration.runs} onShowSkipped={onShowSkipped} />
      </CardContent>
    </Card>
  );
}

/**
 * Platform-admin view of data migrations: every registered migration with
 * its recent runs (boot-registered and requested), a dry run or apply run on
 * demand, and each run's skipped report. Polls while a run is active.
 */
export function DataMigrationsView() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingRequest>(null);
  const [skippedRun, setSkippedRun] = useState<DataMigrationRunDto | null>(null);
  const listOptions = orpc.systemAdmin.listDataMigrations.queryOptions();
  const list = useQuery({
    ...listOptions,
    refetchInterval: (query) => (query.state.data?.items.some((item) => item.runs.some(isActiveRun)) ? ACTIVE_POLL_MS : false),
  });
  const request = useMutation(orpc.systemAdmin.requestDataMigrationRun.mutationOptions({
    onSuccess: async () => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
    },
  }));

  if (list.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (list.isError) return <p className="text-sm text-destructive">{list.error.message}</p>;
  return (
    <div className="flex flex-col gap-4">
      {list.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No data migrations are registered.</p> : null}
      {list.data.items.map((migration) => (
        <DataMigrationCard
          key={migration.id}
          migration={migration}
          onRequest={(dryRun) => {
            request.reset();
            setPending({ migrationId: migration.id, dryRun });
          }}
          onShowSkipped={setSkippedRun}
        />
      ))}
      <ConfirmationDialog
        open={pending !== null}
        title={pending?.dryRun ? 'Start a dry run?' : 'Run this migration?'}
        description={pending?.dryRun
          ? 'A dry run reports what the migration would change and skip, without writing any data.'
          : 'The migration changes existing data. It is idempotent, so items it already migrated stay unchanged.'}
        confirmLabel={pending?.dryRun ? 'Start dry run' : 'Run migration'}
        pending={request.isPending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onConfirm={() => {
          if (pending) request.mutate(pending);
        }}
      >
        {request.isError ? <p className="text-sm text-destructive">{request.error.message}</p> : null}
      </ConfirmationDialog>
      <DataMigrationSkippedDialog run={skippedRun} onOpenChange={(open) => { if (!open) setSkippedRun(null); }} />
    </div>
  );
}
