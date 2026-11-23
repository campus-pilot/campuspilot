import { measure } from '@campuspilot/logger/perf';

/**
 * Gotenberg conversions (and merges) one worker process runs at the same
 * time. Jobs of different schools run side by side (one per school), so
 * without a bound a busy hour would send Gotenberg as many Chromium
 * conversions as there are schools exporting; with it, the rest wait their
 * turn in this process. Starting value from the batching spec; raise it only
 * with measurements of Gotenberg's memory and CPU.
 */
export const DOCUMENT_CONVERSIONS_PER_PROCESS = 2;

let active = 0;
const waiting: Array<() => void> = [];

/**
 * Runs `task` once fewer than {@link DOCUMENT_CONVERSIONS_PER_PROCESS} are
 * running; the rest queue in arrival order. The wait is timed on its own
 * (`doc.pdf.wait`), so a slow batch can be told apart from a queued one.
 */
export async function withConversionSlot<T>(task: () => Promise<T>): Promise<T> {
  while (active >= DOCUMENT_CONVERSIONS_PER_PROCESS) {
    // The loop re-checks after every wake-up, so the timing's extra await cannot let two tasks past the limit.
    await measure('doc.pdf.wait', () => new Promise<void>((resolve) => waiting.push(resolve)));
  }
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}
