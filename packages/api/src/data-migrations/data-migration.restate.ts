import { env } from '@campuspilot/env/server';
import { getRestateClient, rpc } from '@campuspilot/restate/client';

import { signWorkerControlCall } from '../workflows/control-auth';
import { DATA_MIGRATION_CONTROL_SERVICE_NAME, dataMigrationHandoverKey } from '../workflows/data-migration/constants';
import type { DataMigrationControlService } from '../workflows/data-migration/control-service';

/** Bound for one send: Restate itself, not the worker, must answer within it. */
const SEND_TIMEOUT_MS = 5_000;

/**
 * Hands one data migration run to Restate: a signed, one-way, idempotent send
 * to `DataMigrationControl.start`. Restate answers once it has durably
 * accepted the call, whether or not a worker runs, so neither the boot nor a
 * request waits for the worker. A repeated send (sweep retry, replica race)
 * joins the same invocation through the idempotency key.
 */
export async function sendDataMigrationStart(runId: string) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  const input = { runId };
  const headers = signWorkerControlCall(secret, { service: DATA_MIGRATION_CONTROL_SERVICE_NAME, handler: 'start' }, input);
  const sent = await getRestateClient()
    .serviceSendClient<DataMigrationControlService>({ name: DATA_MIGRATION_CONTROL_SERVICE_NAME })
    .start(input, rpc.sendOpts({ idempotencyKey: dataMigrationHandoverKey(runId), headers, timeout: SEND_TIMEOUT_MS }));
  return { invocationId: sent.invocationId };
}
