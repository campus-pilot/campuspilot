import type { DataMigrationRunDto } from '@campuspilot/api/routers/system-admin/data-migration/data-migration.dto';

export type DataMigrationRunStatus = DataMigrationRunDto['status'];

export const runStatusLabels: Record<DataMigrationRunStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

export const runStatusVariants: Record<DataMigrationRunStatus, 'secondary' | 'outline' | 'default' | 'destructive'> = {
  pending: 'outline',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

/** Whether a run still progresses, so the view keeps polling. */
export function isActiveRun(run: Pick<DataMigrationRunDto, 'status'>) {
  return run.status === 'pending' || run.status === 'running';
}
