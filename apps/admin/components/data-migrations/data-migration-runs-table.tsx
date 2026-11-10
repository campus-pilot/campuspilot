'use client';

import type { DataMigrationRunDto } from '@campuspilot/api/routers/system-admin/data-migration/data-migration.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';

import { runStatusLabels, runStatusVariants } from './data-migration-run-labels';

const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/** The status cell: badge plus the hand-over or failure message, when any. */
function RunStatus({ run }: { run: DataMigrationRunDto }) {
  const message = run.error ?? (run.status === 'pending' ? run.lastSubmitError : null);
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={runStatusVariants[run.status]}>{runStatusLabels[run.status]}</Badge>
      {message ? <span className="max-w-xs text-xs whitespace-normal text-muted-foreground">{message}</span> : null}
    </div>
  );
}

/** Recent runs of one migration with counts; skipped items open on demand. */
export function DataMigrationRunsTable({ runs, onShowSkipped }: {
  runs: DataMigrationRunDto[];
  onShowSkipped: (run: DataMigrationRunDto) => void;
}) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Requested</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Processed</TableHead>
          <TableHead className="text-right">Changed</TableHead>
          <TableHead className="text-right">Needs attention</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>{dateFormatter.format(run.requestedAt)}{run.requestedBy ? '' : ' (boot)'}</TableCell>
            <TableCell>{run.dryRun ? 'Dry run' : 'Apply'}</TableCell>
            <TableCell><RunStatus run={run} /></TableCell>
            <TableCell className="text-right tabular-nums">{run.processedCount}</TableCell>
            <TableCell className="text-right tabular-nums">{run.changedCount}</TableCell>
            <TableCell className="text-right tabular-nums">
              {run.skippedCount > 0
                ? <Button variant="link" size="sm" onClick={() => onShowSkipped(run)}>{run.skippedCount}</Button>
                : 0}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
