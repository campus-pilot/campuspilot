/**
 * Restate names for data migrations. Kept free of runtime imports so the API
 * can reference the services by name and type without importing the worker
 * implementation.
 */
export const DATA_MIGRATION_WORKFLOW_NAME = 'DataMigration';
/** The only ingress-callable data migration service; it validates the run before starting the workflow. */
export const DATA_MIGRATION_CONTROL_SERVICE_NAME = 'DataMigrationControl';

/**
 * Workflow key of one run: `{migrationId}/{runId}`. The migration ID makes
 * runs readable in Restate; the run ID makes each requested run (apply or dry
 * run) its own workflow, since a workflow key runs only once.
 */
export function dataMigrationWorkflowKey(migrationId: string, runId: string): string {
  return `${migrationId}/${runId}`;
}

/** Restate's idempotency key for handing one run to the control service. */
export function dataMigrationHandoverKey(runId: string): string {
  return `data-migration:${runId}`;
}
