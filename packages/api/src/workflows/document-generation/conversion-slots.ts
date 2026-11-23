import { measure } from '@campuspilot/logger/perf';

/**
 * Per-process limits on the heavy parts of document jobs. Jobs of different
 * schools run side by side (one per school), so without a bound a busy hour
 * would start as many Gotenberg conversions, and hold as many batches of
 * images and HTML in memory, as there are schools exporting. A slot covers
 * the whole step: reading a batch's images, rendering it, converting and
 * storing it (or merging), so worker memory is bounded by the slots, not by
 * the number of jobs. Starting values from the batching spec; raise them only
 * with measurements of worker and Gotenberg memory and CPU.
 */
export const DOCUMENT_CONVERSIONS_PER_PROCESS = 2;
/** Prepare steps (every context of a job, measuring every document) one process runs at once. */
export const DOCUMENT_PREPARES_PER_PROCESS = 1;

/**
 * How long a job waits for a slot before giving up this attempt. Kept under
 * the Restate object's inactivity timeout (15 minutes): the wait happens
 * outside any journaled step, so giving up only makes Restate retry the
 * invocation later, from its journal; no step runs twice.
 */
export const SLOT_WAIT_LIMIT_MS = 10 * 60_000;

/** A job waited longer than {@link SLOT_WAIT_LIMIT_MS}; the invocation is retried, the job is not failed. */
export class SlotWaitTimeout extends Error {
  constructor() {
    super('Waited too long for a document job slot; Restate retries the job.');
    this.name = 'SlotWaitTimeout';
  }
}

type Waiter = { wake: () => void; timer: NodeJS.Timeout };

function createSlots(size: number, waitStep: string) {
  let active = 0;
  const waiting: Waiter[] = [];
  /**
   * Runs `task` once fewer than `size` are running; the rest queue in arrival
   * order. A wait longer than {@link SLOT_WAIT_LIMIT_MS} throws
   * {@link SlotWaitTimeout} and leaves the queue. The wait is timed on its own,
   * so a slow step can be told apart from a queued one.
   */
  return async function withSlot<T>(task: () => Promise<T>): Promise<T> {
    while (active >= size) {
      // The loop re-checks after every wake-up, so the timing's extra await cannot let two tasks past the limit.
      await measure(
        waitStep,
        () =>
          new Promise<void>((resolve, reject) => {
            const waiter: Waiter = {
              wake: () => {
                clearTimeout(waiter.timer);
                resolve();
              },
              timer: setTimeout(() => {
                const index = waiting.indexOf(waiter);
                if (index >= 0) waiting.splice(index, 1);
                reject(new SlotWaitTimeout());
              }, SLOT_WAIT_LIMIT_MS),
            };
            waiting.push(waiter);
          }),
      );
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.wake();
    }
  };
}

/** A batch step (images, render, conversion, storage) or a merge. */
export const withConversionSlot = createSlots(DOCUMENT_CONVERSIONS_PER_PROCESS, 'doc.pdf.wait');
/** A prepare step. */
export const withPrepareSlot = createSlots(DOCUMENT_PREPARES_PER_PROCESS, 'doc.job.prepare.wait');
