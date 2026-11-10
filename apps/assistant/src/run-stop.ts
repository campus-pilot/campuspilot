import { ASSISTANT_TERMINAL_RUN_STATUSES, type AssistantRunDto } from '@campuspilot/assistant-contract/dto';

import { db } from './db/client';
import { signalAssistantRunStop } from './events';
import * as store from './store';

/** Wakes a run that waits on an approval, telling it the approval was cancelled. */
export type CancelApproval = (awakeableId: string) => Promise<void>;

/**
 * Stops a run for the user. Every step can be repeated, so a stop that
 * failed halfway (Redis or Restate briefly unreachable) is finished by
 * pressing Stop again:
 * 1. The request is recorded on the run, once. The turn checks it between
 *    steps, and before it creates an approval (holding the run's row lock,
 *    so an approval is either refused or already visible to step 3).
 * 2. A reply that is streaming is told to stop.
 * 3. An approval the run waits on is cancelled and the run woken. If the
 *    wake-up fails, the approval is put back to pending and the error
 *    rethrown, so the next Stop finds it and tries again; it cannot be
 *    approved meanwhile (`respondToApproval` refuses once a stop is asked).
 * A run that has already ended is returned as it is.
 */
export async function stopRun(run: store.RunRow, cancelApproval: CancelApproval): Promise<AssistantRunDto> {
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
  if (pending && (await store.decideApproval(db, pending.id, 'cancelled'))) {
    try {
      await cancelApproval(pending.awakeableId);
    } catch (error) {
      await store.reopenApproval(db, pending.id);
      throw error;
    }
  }
  return stopped;
}
