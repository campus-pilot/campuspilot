import { ASSISTANT_TERMINAL_RUN_STATUSES, type AssistantRunDto } from '@campuspilot/assistant-contract/dto';

import { db } from './db';
import { signalAssistantRunStop } from './events';
import * as store from './store';

/** Hands a decided approval to the worker so the waiting run wakes (see dispatch.ts). */
export type HandOverApproval = (approvalId: string) => Promise<unknown>;

/**
 * Stops a run for the user. Every step can be repeated, so a stop that
 * failed halfway (Redis briefly unreachable) is finished by pressing Stop
 * again:
 * 1. The request is recorded on the run, once. The turn checks it between
 *    steps, and before it creates an approval (holding the run's row lock,
 *    so an approval is either refused or already visible to step 3).
 * 2. A reply that is streaming is told to stop.
 * 3. An approval the run waits on is cancelled in the database, which is
 *    the decision the run wakes with, and handed to the worker. A hand-over
 *    that fails is not an error here: the cancel is already durable and the
 *    outbox sweep sends it until Restate accepts it. It cannot be approved
 *    meanwhile (the approval is no longer pending, and `respondToApproval`
 *    refuses once a stop is asked).
 * A run that has already ended is returned as it is.
 */
export async function stopRun(run: store.RunRow, handOverApproval: HandOverApproval): Promise<AssistantRunDto> {
  if (ASSISTANT_TERMINAL_RUN_STATUSES.has(run.status)) return store.toRunDto(run);
  const stopped = run.stopRequestedAt
    ? store.toRunDto(run)
    : await store.assistantTransaction(db, async (tx, emit) => {
        // The run's row first, then (inside `updateRun`) the conversation's
        // counter: the order the turn takes them in when it creates an
        // approval. The opposite order would deadlock against it.
        await store.lockRun(tx, run.id);
        return store.updateRun(tx, emit, run, { stopRequestedAt: new Date() });
      });
  await signalAssistantRunStop(run.id);

  const pending = await store.findPendingApprovalForRun(db, run.id);
  const cancelled = pending ? await store.decideApproval(db, pending.id, 'cancelled') : null;
  // An approval this or an earlier stop cancelled and that is still owed to
  // the worker: a repeated Stop hands it over again.
  const owed = cancelled ?? (await store.findUnhandedCancelledApprovalForRun(db, run.id));
  if (owed) await handOverApproval(owed.id);
  return stopped;
}
