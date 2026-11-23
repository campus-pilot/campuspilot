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
 *
 * A slot is taken INSIDE a step's closure (`generation.ts`), never around the
 * journaled step: the closure always settles (its `finally` returns the slot,
 * even when the step fails and Restate retries it), and it never runs on a
 * replay of a step that is already journaled. A Restate attempt that ends
 * while the closure still waits aborts the wait (`signal`).
 */
export const DOCUMENT_CONVERSIONS_PER_PROCESS = 2;
/** Prepare steps (every context of a job, measuring every document) one process runs at once. */
export const DOCUMENT_PREPARES_PER_PROCESS = 1;

/**
 * How long a step waits for a slot before it gives up this wait. Kept under
 * the Restate object's inactivity timeout (15 minutes) together with the
 * work that follows. A step that gives up is journaled as such and waits
 * again in a new step (`generation.ts`), so waiting never uses the step's
 * own retries.
 */
export const SLOT_WAIT_LIMIT_MS = 10 * 60_000;

/** A step waited longer than {@link SLOT_WAIT_LIMIT_MS}. */
export class SlotWaitTimeout extends Error {
  constructor() {
    super('Waited too long for a document job slot.');
    this.name = 'SlotWaitTimeout';
  }
}

type Waiter = { grant: () => void; leave: () => void };

/**
 * A first-come-first-served limit of `size` tasks. A released slot is handed
 * straight to the oldest waiter (it is never free in between), so a newcomer
 * cannot take it first.
 */
export function createSlots(size: number, waitStep: string) {
  let active = 0;
  const waiting: Waiter[] = [];

  function acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('The attempt ended.'));
    if (active < size && waiting.length === 0) {
      active += 1;
      return Promise.resolve();
    }
    return measure(
      waitStep,
      () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            waiter.leave();
            reject(new SlotWaitTimeout());
          }, SLOT_WAIT_LIMIT_MS);
          const onAbort = () => {
            waiter.leave();
            reject(signal?.reason ?? new Error('The attempt ended.'));
          };
          const waiter: Waiter = {
            // The releasing task keeps `active` as it is: the slot changes hands.
            grant: () => {
              clearTimeout(timer);
              signal?.removeEventListener('abort', onAbort);
              resolve();
            },
            leave: () => {
              clearTimeout(timer);
              signal?.removeEventListener('abort', onAbort);
              const index = waiting.indexOf(waiter);
              if (index >= 0) waiting.splice(index, 1);
            },
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          waiting.push(waiter);
        }),
    );
  }

  function release() {
    const next = waiting.shift();
    if (next) next.grant();
    else active -= 1;
  }

  /**
   * Runs `task` holding one slot; the slot is returned when `task` settles,
   * whatever it throws. Throws {@link SlotWaitTimeout} after waiting
   * {@link SLOT_WAIT_LIMIT_MS}, or the signal's reason when it aborts.
   */
  async function withSlot<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  }

  /** Slots held and tasks waiting, for tests. */
  withSlot.usage = () => ({ active, waiting: waiting.length });
  return withSlot;
}

export type SlotLimiter = ReturnType<typeof createSlots>;

/** A batch step (images, render, conversion, storage) or a merge. */
export const withConversionSlot = createSlots(DOCUMENT_CONVERSIONS_PER_PROCESS, 'doc.pdf.wait');
/** A prepare step. */
export const withPrepareSlot = createSlots(DOCUMENT_PREPARES_PER_PROCESS, 'doc.job.prepare.wait');
