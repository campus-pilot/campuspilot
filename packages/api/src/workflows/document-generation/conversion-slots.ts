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

/**
 * How long a place in the queue is kept for a step that stopped waiting
 * (`SLOT_WAIT_LIMIT_MS`) and is expected to wait again at once under its next
 * name, and how long a slot granted meanwhile is held for it.
 */
export const SLOT_PLACE_KEPT_MS = 60_000;

type Waiter = {
  key: string | undefined;
  /** Set while a call is waiting on this place; unset between a timeout and the next wait. */
  attached: { resolve: () => void; reject: (error: unknown) => void } | null;
  granted: boolean;
  timers: Set<NodeJS.Timeout>;
};

/**
 * A first-come-first-served limit of `size` tasks. A released slot is handed
 * straight to the oldest waiter (it is never free in between), so a newcomer
 * cannot take it first. A wait with a `key` that runs out keeps its place:
 * the next wait with the same key (the step waiting again, `name:wait-N`)
 * resumes it, and a slot granted in between is held for it; a place nobody
 * resumes within {@link SLOT_PLACE_KEPT_MS} is given up.
 */
export function createSlots(size: number, waitStep: string) {
  let active = 0;
  const waiting: Waiter[] = [];
  const byKey = new Map<string, Waiter>();

  function clearTimers(waiter: Waiter) {
    for (const timer of waiter.timers) clearTimeout(timer);
    waiter.timers.clear();
  }
  function forget(waiter: Waiter) {
    clearTimers(waiter);
    const index = waiting.indexOf(waiter);
    if (index >= 0) waiting.splice(index, 1);
    if (waiter.key !== undefined && byKey.get(waiter.key) === waiter) byKey.delete(waiter.key);
  }
  function release() {
    const next = waiting.shift();
    if (!next) {
      active -= 1;
      return;
    }
    // The slot changes hands: `active` stays as it is.
    if (next.attached) {
      forget(next);
      next.attached.resolve();
      return;
    }
    // Its step is between two waits: hold the slot for it, briefly.
    next.granted = true;
    next.timers.add(
      setTimeout(() => {
        forget(next);
        release();
      }, SLOT_PLACE_KEPT_MS),
    );
  }

  function attach(waiter: Waiter, signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        // The attempt ended: its retry starts the step again from the start of the queue.
        forget(waiter);
        reject(signal?.reason ?? new Error('The attempt ended.'));
      };
      waiter.attached = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject,
      };
      clearTimers(waiter);
      waiter.timers.add(
        setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          waiter.attached = null;
          // A keyed place is kept for the step's next wait, for a while; any other leaves.
          if (waiter.key === undefined) forget(waiter);
          else waiter.timers.add(setTimeout(() => forget(waiter), SLOT_PLACE_KEPT_MS));
          reject(new SlotWaitTimeout());
        }, SLOT_WAIT_LIMIT_MS),
      );
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function acquire(signal?: AbortSignal, key?: string): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('The attempt ended.'));
    const kept = key === undefined ? undefined : byKey.get(key);
    if (kept?.granted) {
      forget(kept);
      return Promise.resolve();
    }
    if (kept) return measure(waitStep, () => attach(kept, signal));
    if (active < size && waiting.length === 0) {
      active += 1;
      return Promise.resolve();
    }
    const waiter: Waiter = { key, attached: null, granted: false, timers: new Set() };
    waiting.push(waiter);
    if (key !== undefined) byKey.set(key, waiter);
    return measure(waitStep, () => attach(waiter, signal));
  }

  /**
   * Runs `task` holding one slot; the slot is returned when `task` settles,
   * whatever it throws. Throws {@link SlotWaitTimeout} after waiting
   * {@link SLOT_WAIT_LIMIT_MS} (a `key` keeps the place for the next wait), or
   * the signal's reason when it aborts.
   */
  async function withSlot<T>(task: () => Promise<T>, signal?: AbortSignal, key?: string): Promise<T> {
    await acquire(signal, key);
    try {
      return await task();
    } finally {
      release();
    }
  }

  /** Slots held and places waiting, for tests. */
  withSlot.usage = () => ({ active, waiting: waiting.length });
  return withSlot;
}

export type SlotLimiter = ReturnType<typeof createSlots>;

/** A batch step (images, render, conversion, storage) or a merge. */
export const withConversionSlot = createSlots(DOCUMENT_CONVERSIONS_PER_PROCESS, 'doc.pdf.wait');
/** A prepare step. */
export const withPrepareSlot = createSlots(DOCUMENT_PREPARES_PER_PROCESS, 'doc.job.prepare.wait');
